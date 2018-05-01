import { open, write, read, HIGH, LOW, PULL_DOWN, INPUT, OUTPUT } from "rpio"
import { Service, Characteristic, MutableCharacteristic } from "./services"
import { Config } from "./config"

// https://github.com/KhaosT/HAP-NodeJS/blob/1f1fea7a995f09671d5e0aba50e965c1f4729f4d/lib/gen/HomeKitTypes.js#L476
/**
 * All of the states possible for the door.
 */
enum DoorState {
	open = 0,
	closed = 1,
	opening = 2,
	closing = 3,
	stopped = 4
}

// https://github.com/KhaosT/HAP-NodeJS/blob/1f1fea7a995f09671d5e0aba50e965c1f4729f4d/lib/gen/HomeKitTypes.js#L2268
/**
 * The states that can possibly be set as the target state.
 */
type TargetState = DoorState.open | DoorState.closed

/**
 * The possible states that can be calculated from the sensors available.
 */
type CalculatedState = DoorState.open | DoorState.closed | DoorState.stopped

/**
 * This is the entity that encapsulates the garage door opening and pi logic.
 */
export class GaragePi {
	/**
	 * The default value for the polling interval. Defaults to `300`.
	 */
	static readonly DEFAULT_POLLING_INTERVAL = 300

	/**
	 * The default value for the duration to press the garage button. Defaults
	 *   to `300`.
	 */
	static readonly DEFAULT_DURATION_TO_PRESS_BUTTON = 300

	/**
	 * This is the services that will be used by Homebridge service to
	 *   understand and communicate with our accesory
	 */
	services: any[]

	/**
	 * This is the homebridge characteristic for the current door state
	 */
	doorState: MutableCharacteristic<DoorState>

	/**
	 * This is the homebridge characteristic for the target door state
	 */
	doorTargetState: MutableCharacteristic<TargetState>

	/**
	 * This is the backing store for the `storedState` variable. Please don't
	 *   access this directly.
	 */
	private _storedState: DoorState = undefined as any

	/**
	 * This is the door's state, as far as we know. Update this when we know it
	 *   has changed, or access it to see what we think it currently is.
	 */
	get storedState() {
		return this._storedState
	}
	set storedState(newValue) {
		const oldValue = this._storedState

		this._storedState = newValue

		if (oldValue !== undefined) {
			this.doorState.updateValue(newValue)
		}

		this.log(`Updated state to "${DoorState[newValue]}"`)

		if (newValue === DoorState.closed ||
			newValue === DoorState.closing) {
			this.storedTargetState = DoorState.closed
		} else {
			this.storedTargetState = DoorState.open
		}
	}

	/**
	 * This is the backing store for the `_targetStoredState` variable. Please
	 *   don't access this directly.
	 */
	private _storedTargetState: TargetState = undefined as any

	/**
	 * This is the target state that we have stored for future reference.
	 */
	get storedTargetState() {
		return this._storedTargetState
	}
	set storedTargetState(newValue) {
		const oldValue = this._storedTargetState

		this._storedTargetState = newValue

		if (oldValue !== undefined) {
			this.doorTargetState.updateValue(newValue)
		}

		this.log(`Updated target to "${DoorState[newValue]}"`)
	}

	/**
	 * This will either be a cancel function for the last wait, or undefined if
	 *   we are not currently waiting for anything. This resets to the initial
	 *   value of undefined after the passed duration for movement.
	 */
	cancelMovementCompleteCallback: (() => void) | undefined

	/**
	 * After we programatically press the button, let's wait a few seconds for
	 *   the door to actually physically react. This will ensure we don't run
	 *   into a race condition where the door registers as still open/closed
	 *   because it hasn't started moving yet
	 */
	waitingForInitialMovement = false

	/**
	 * A queue of the set requests. This prevents button mashing from tripping
	 *   the system up.
	 */
	setQueue: [TargetState, () => void][] = []

	/**
	 * This constructs an instance of our accessory, setting up all of the
	 *   appropriate services and handlers, as well as starting the polling.
	 *
	 * @param log    The log function provided by Homebridge. Logging something
	 * 				   here will print it to the Homebridge console.
	 * @param config The configuration as defined by the user and the default
	 * 				   values. Any optional values that the user doesn't provide
	 * 				   will be populated with defaults, if there is one for that
	 * 				   option.
	 */
	constructor(public log: (message: any) => void, public config: Config) {
		// Fill in the defaults for whatever of the optional values are missing
		this.config = Object.assign({
			pollingInterval: GaragePi.DEFAULT_POLLING_INTERVAL,
			durationToPressButton: GaragePi.DEFAULT_DURATION_TO_PRESS_BUTTON
		}, this.config)

		const requiredOptions = [
			"name",
			"buttonPin",
			"openSensorPin",
			"closedSensorPin",
			"durationOfMovement"
		]

		const definedOptions = Object.keys(this.config)
		const missingOptions = requiredOptions.filter((option) => definedOptions.indexOf(option) < 0)

		// If any of the required properties are missing, we need to report it
		if (missingOptions.length > 0) {
			for (const item of missingOptions) {
				log(`ERROR! The "${item}" key is not set in the config file!`)
			}

			throw new Error(`Missing keys in config: ${missingOptions}`)
		}

		open(this.config.buttonPin, OUTPUT, LOW)
		open(this.config.openSensorPin, INPUT, PULL_DOWN)
		open(this.config.closedSensorPin, INPUT, PULL_DOWN)

		// If the sensors are powered by a GPIO pin, we open it here
		if (this.config.sensorPowerPin != undefined) {
			open(this.config.sensorPowerPin, OUTPUT, HIGH)
		}

		/**
		 * This is the info service – it gets populated with information about
		 *   our custom accessory
		 */
		const infoService = new Service.AccessoryInformation()

		/**
		 * The is the actual accessory service. It gets populated with the
		 *   handlers to handle the get and set events of the door properties
		 */
		const doorService = new Service.GarageDoorOpener(this.config.name, this.config.name)

		this.services = [infoService, doorService]

		infoService
			.setCharacteristic(Characteristic.Manufacturer, "Eric Ferreira")
			.setCharacteristic(Characteristic.Model, "Garage Pi Opener")
			.setCharacteristic(Characteristic.SerialNumber, "000-000-001")

		this.doorState = doorService.getCharacteristic(Characteristic.CurrentDoorState)
		this.doorTargetState = doorService.getCharacteristic<TargetState>(Characteristic.TargetDoorState)

		this.doorState.on("get", (callback) => callback(null, this.storedState))

		this.doorTargetState
			.on("get", (callback) => callback(null, this.storedTargetState))
			.on("set", (state, callback) => {
				this.log(`Request state "${DoorState[state]}"`)
				this.setQueue.push([state, callback])

				return true
			})

		this.startPolling()
	}

	private clearMovement() {
		if (this.cancelMovementCompleteCallback != undefined) {
			this.log("Cancelling pending callback")
			this.cancelMovementCompleteCallback()
			this.cancelMovementCompleteCallback = undefined
		}
	}

	private queueMovement() {
		this.log("Queueing movement callback")
		this.cancelMovementCompleteCallback = delay(() => {
			this.log("Movement callback called")
			this.storedState = this.getCalculatedState()
			this.cancelMovementCompleteCallback = undefined
		}, this.config.durationOfMovement)
	}

	/**
	 * A buffer that will iron out any noise in the sensor readings. We will
	 *   only process sensor readings when they are at least 75% of the last
	 *   four readings.
	 */
	calculatedStateBuffer = makeBuffer<CalculatedState>()

	async startPolling() {
		// First check if there is any pending set calls
		const set = this.setQueue.shift()

		// If there is a pending set call, process it this iteration
		if (set != undefined) {
			// Unwrap the current set request from the queue
			const [targetState, done] = set

			// If the target state is already the same as the stored state
			if (targetState === this.storedState) {
				// Call the done callback
				done()
			} else {
				// If there was already a pending callback, cancel it!
				this.clearMovement()

				// Press the button to get the door moving!
				this.log("Pressing button")
				const buttonPress = this.pressButton()

				// Calculate the next state based on the stored current state
				//   and the standard garage movements
				let newState = (() => {
					switch (this.storedState) {
						case DoorState.open:
							return DoorState.closing
						case DoorState.closed:
							return DoorState.opening
						case DoorState.opening:
							return DoorState.stopped
						case DoorState.closing:
							return DoorState.opening
						case DoorState.stopped:
							return DoorState.closing
					}
				})()

				let needToWaitForInitialMovement = false

				if (this.storedState === DoorState.closed ||
					this.storedState === DoorState.open) {
					needToWaitForInitialMovement = true
				}

				this.storedState = newState

				// Call the callback to let homebridge know the set was successful
				done()

				await buttonPress
				this.log("Done pressing button")

				// If the door didn't transition to stopped, we need to wait for
				//   movement to end.
				if (newState !== DoorState.stopped) {
					this.queueMovement()
				}

				if (needToWaitForInitialMovement) {
					this.waitingForInitialMovement = true

					delay(() => {
						this.waitingForInitialMovement = false
					}, this.config.durationOfMovement / 5)
				}
			}
		} else if (!this.waitingForInitialMovement) {
			// We enter here if there isn't a pending set request and we aren't
			//   currently waiting for the door to start moving after pressing
			//   the button

			const calculatedState = this.getCalculatedState()

			// this.log(`Calculated state is "${DoorState[calculatedState]}"`)

			// Add the newest value to the beginning of the array. We'll trim
			//  from the end later.
			this.calculatedStateBuffer.push(calculatedState)

			// Only process the state if the buffer has had time to populate.
			//   Otherwise, let's just keep moving.
			if (this.calculatedStateBuffer.populated) {
				// Only process the current calculated state if half or more of
				//   the states in the buffer equal the calculated state
				if (this.calculatedStateBuffer.filter((state) => state === calculatedState).length >= 0.75 * this.calculatedStateBuffer.length) {
					// If the calculated state doesn't match the stored state, then we
					//   need to determine what the actual new state should be
					if (calculatedState !== this.storedState) {
						// It now it is either open or closed (and wasn't before,
						//   because at this point we know that it is different than the
						//   previous state)
						if (calculatedState !== DoorState.stopped) {
							// Clear any pending movement callback, if it hasn't been
							//   triggered yet. The door reached the end so we don't
							//   need to wait for it to move any more
							this.clearMovement()

							this.log(`State updated in poll`)
							this.storedState = calculatedState
						} else if (this.cancelMovementCompleteCallback == undefined) {
							// There is currently no movement callback active

							// We are updating the state to what it should be next. If
							//   the door was previously open, it is now closing. If it
							//   was previously closed, it's now opening. Anything else,
							//   we just update it to the calculated value. In addition,
							//   if it was previously open or closed, we assume someone
							//   pressed the physical button and we should queue a
							//   movement callback that will update the state after the
							//   movement finishes
							this.log(`State updated in poll`)
							this.storedState = (() => {
								switch (this.storedState) {
								case DoorState.closed:
									this.queueMovement()

									return DoorState.opening
								case DoorState.open:
									this.queueMovement()

									return DoorState.closing
								default:
									return calculatedState
								}
							})()
						}
					}
				}
			}
		}

		// Queue up the next poll iteration
		setTimeout(() => this.startPolling(), this.config.pollingInterval)
	}

	/**
	 * Get the plain and simple calculated current state based on the available
	 *   sensors. We can really only know whether the door is open, closed, or
	 *   somewhere in between. If it is somewhere in between, we just report it
	 *   as stopped.
	 */
	getCalculatedState() {
		/**
		 * This is if the value of the open sensor is true. The door is all the
		 *   way open. If false, it's either partially open or closed.
		 */
		const isOpen = read(this.config.openSensorPin) === HIGH

		/**
		 * This is if the value of the closed sensor is true. The door is all
		 *   the way closed. If false, it's open either partially or all the
		 *   way.
		 */
		const isClosed = read(this.config.closedSensorPin) === HIGH

		// If both sensors read as true, something really funky is going on
		if (isOpen && isClosed) {
			this.log("Both sensors read as true. Error state!")
		}

		// this.log(`Sensor states are (Open: ${isOpen}) and (Closed: ${isClosed})`)

		return isOpen ?
			DoorState.open :
			isClosed ?
				DoorState.closed :
				DoorState.stopped
	}

	/**
	 * This function presses the garage door button for the specified duration.
	 *
	 * This is the garage behavior on button press:
	 * * When open -> closing
	 * * When closed -> opening
	 * * When opening -> stopped
	 * * When closing -> opening
	 * * When stopped -> closing
	 */
	async pressButton() {
		// Press the button!
		write(this.config.buttonPin, HIGH)

		// Wait the configured press duration before continuing
		await resolveIn(this.config.durationToPressButton)

		// Release the button!
		write(this.config.buttonPin, LOW)

		// Wait the configurated press duration again to allow for propagation
		await resolveIn(this.config.durationToPressButton)
	}

	/**
	 * This function is required by Homebridge and returns the services that
	 *   define this plugin.
	 */
	getServices() {
		return this.services
	}
}

/**
 * Returns a promise that will resolve in the passed number of milliseconds.
 */
async function resolveIn(millis: number) {
	return new Promise<void>((resolve) => {
		setTimeout(resolve, millis)
	})
}

/**
 * Delay the execution of a block for a certain number of milliseconds. Returns
 *   a function that when called will cancel the pending execution.
 */
function delay(block: () => void, millis: number = 0): () => void {
	const timer = setTimeout(block, millis)

	return () => {
		clearTimeout(timer)
	}
}

function makeBuffer<T>(length: number = 4) {
	interface Buffer<T> extends Array<T> {
		populated: boolean
	}

	const buffer = new Proxy([], {
		get(target, prop) {
			if (prop === "unshift") {
				return function() {
					target.unshift.apply(target, arguments)

					if (target.length > 4) {
						target.length = 4
					}
				}
			} else if (prop === "push") {
				return function() {
					target.push.apply(target, arguments)

					if (target.length > 4) {
						target.splice(0, target.length - 4)
					}
				}
			} else {
				return (target as any)[prop]
			}
		}
	}) as any

	Object.defineProperty(buffer, "populated", {
		get(this: Buffer<T>) {
			return this.length >= length
		}
	})

	return buffer as Buffer<T>
}
