import { HIGH, INPUT, LOW, open, OUTPUT, PULL_DOWN, read, write } from "rpio"
import { Config } from "./config"
import { AccesorryCharacteristic, Characteristic, Has, ItemCharacteristic, MutableCharacteristic, Service } from "./services"

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
 * The states that can possibly be set as the target state.
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
	private get isMovementCallbackPending() {
		return this._cancelMovementCallback != undefined
	}

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

		if (oldValue != undefined) {
			this.doorState.updateValue(newValue)
		}

		this.log(`Updated state to "${DoorState[newValue]}"`)

		this.storedTargetState = newValue === DoorState.closed || newValue === DoorState.closing
			? DoorState.closed
			: this.storedTargetState = DoorState.open
	}

	/**
	 * This is the target state that we have stored for future reference.
	 */
	get storedTargetState() {
		return this._storedTargetState
	}
	set storedTargetState(newValue) {
		const oldValue = this._storedTargetState

		this._storedTargetState = newValue

		if (oldValue != undefined) {
			// Let's try doing this twice to see if it fixes the refresh issue
			this.doorTargetState.updateValue(newValue)
			this.doorTargetState.updateValue(newValue)
		}

		this.log(`Updated target to "${DoorState[newValue]}"`)
	}

	/**
	 * The default value for the duration to press the garage button. Defaults
	 *   to `300`.
	 */
	static readonly DEFAULT_DURATION_TO_PRESS_BUTTON = 300
	/**
	 * The default value for the polling interval. Defaults to `250`.
	 */
	static readonly DEFAULT_POLLING_INTERVAL = 250

	/**
	 * This is the homebridge characteristic for the current door state
	 */
	doorState: MutableCharacteristic<DoorState>

	/**
	 * This is the homebridge characteristic for the target door state
	 */
	doorTargetState: MutableCharacteristic<TargetState>

	processingRequests = false

	/**
	 * This is the services that will be used by Homebridge service to
	 *   understand and communicate with our accesory
	 */
	services: [Has<AccesorryCharacteristic>, Has<ItemCharacteristic>]

	/**
	 * This will either be a cancel function for the last wait, or undefined if
	 *   we are not currently waiting for anything. This resets to the initial
	 *   value of undefined after the passed duration for movement.
	 */
	private _cancelMovementCallback: (() => void) | undefined

	/**
	 * This is the backing store for the `storedState` variable. Please don't
	 *   access this directly.
	 */
	private _storedState!: DoorState

	/**
	 * This is the backing store for the `_targetStoredState` variable. Please
	 *   don't access this directly.
	 */
	private _storedTargetState!: TargetState

	/**
	 * A buffer that will iron out any noise in the sensor readings. We will
	 *   only process sensor readings when they are at least 75% of the last
	 *   four readings.
	 */
	private readonly calculatedStateBuffer = makeBuffer<CalculatedState>()

	/**
	 * A queue of the set requests. This prevents button mashing from tripping
	 *   the system up.
	 */
	private readonly requestQueue: TargetState[] = []

	/**
	 * After we programatically press the button, let's wait a few seconds for
	 *   the door to actually physically react. This will ensure we don't run
	 *   into a race condition where the door registers as still open/closed
	 *   because it hasn't started moving yet
	 */
	private waitingForInitialMovement = false

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
	constructor(public log: <T>(message: T) => void, public config: Config) {
		// Fill in the defaults for whatever of the optional values are missing
		this.config = {
			pollingInterval: GaragePi.DEFAULT_POLLING_INTERVAL,
			durationToPressButton: GaragePi.DEFAULT_DURATION_TO_PRESS_BUTTON,
			...this.config
		}

		const requiredOptions = [
			`name`,
			`buttonPin`,
			`openSensorPin`,
			`closedSensorPin`,
			`durationOfMovement`
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
			.setCharacteristic(Characteristic.Manufacturer, `Eric Ferreira`)
			.setCharacteristic(Characteristic.Model, `Garage Pi Opener`)
			.setCharacteristic(Characteristic.SerialNumber, `000-000-001`)

		this.doorState = doorService.getCharacteristic(Characteristic.CurrentDoorState)
		this.doorTargetState = doorService.getCharacteristic<TargetState>(Characteristic.TargetDoorState)

		this.doorState.on(`get`, (callback) => callback(undefined, this.storedState))

		this.doorTargetState
			.on(`get`, (callback) => callback(undefined, this.storedTargetState))
			.on(`set`, (state, callback) => {
				callback()

				delay(() => this.queueRequest(state))

				return true
			})

		this.poll().catch()
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
			this.log(`Both sensors read as true. Error state!`)
		}

		// this.log(`Sensor states are (Open: ${isOpen}) and (Closed: ${isClosed})`)

		return isOpen ?
			DoorState.open :
			isClosed ?
				DoorState.closed :
				DoorState.stopped
	}

	/**
	 * This function is required by Homebridge and returns the services that
	 *   define this plugin.
	 */
	getServices() {
		return this.services
	}

	async poll() {
		// We enter the calculation step only if we aren't currently processing
		//   a set request or waiting for the door to start moving after
		//   pressing the button.
		if (!this.processingRequests && !this.waitingForInitialMovement) {
			/**
			 * Calculate the state based on the sensors that we have. This is
			 *   basically whether the door is all the way open, all the way
			 *   closed, or neither.
			 */
			const calculatedState = this.getCalculatedState()

			// Add the newest value to the buffer
			this.calculatedStateBuffer.push(calculatedState)

			// Only process the current calculated state if the predict of the
			//   buffer equals the calculated state. This ensures that noise is
			//   properly filtered out. We also only move forward if the stored
			//   state is different from the calculated state
			if (this.calculatedStateBuffer.predict === calculatedState &&
					calculatedState !== this.storedState) {
				// It now it is either open or closed (and wasn't before,
				//   because at this point we know that it is different than the
				//   previous state)
				if (calculatedState !== DoorState.stopped) {
					// Clear any pending movement callback, if it hasn't been
					//   triggered yet. The door reached the end so we don't
					//   need to wait for it to move any more
					this.cancelMovementCallback()

					this.log(`State updated in poll because the door was calculated as`)
					this.log(`  ${DoorState[calculatedState]} and we weren't processing requests or waiting`)
					this.log(`  for an initial movement.`)
					this.storedState = calculatedState
				} else if (!this.isMovementCallbackPending) {
					// There is currently no movement callback active, but the
					//   door still changed from our last calculated state. We
					//   now update the state accordingly. If the door was
					//   previously open, it is now closing. If it was
					//   previously closed, it's now opening. Anything else, we
					//   just update it to the calculated value. In addition, if
					//   it was previously open or closed, we assume someone
					//   pressed the physical button and we should queue a
					//   movement callback that will update the state after the
					//   movement finishes.

					this.log(`State updated in poll because there was no movement`)
					this.log(`  callback pending and the state wasn't what we expected.`)
					if ([DoorState.closed, DoorState.open]
							.indexOf(this.storedState) >= 0) {
						this.queueMovementCallback()

						this.storedState = this.storedState === DoorState.closed ?
							DoorState.opening :
							DoorState.closing
					} else {
						this.storedState = calculatedState
					}
				}
			}
		}

		// Queue up the next poll iteration
		setTimeout(() => this.poll(), this.config.pollingInterval)
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
	 * Cancel the currently queued movement callback, if there is one. This is
	 *   a no-op if there is no queued callback
	 */
	private cancelMovementCallback() {
		if (this._cancelMovementCallback != undefined) {
			this.log(`Cancelling pending callback`)
			this._cancelMovementCallback()
			this._cancelMovementCallback = undefined
		}
	}

	private async processRequests() {
		this.processingRequests = this.requestQueue.length > 0

		while (this.processingRequests) {
			const target = this.requestQueue[0]

			this.log(`Process request for "${DoorState[target]}"`)

			// If the target state is already the same as the stored state, or
			//   the target state will be reached if the door keeps moving as we
			//   currently think it is.
			if (target === DoorState.closed &&
					[DoorState.closed, DoorState.closing]
						.indexOf(this.storedState) >= 0 ||
					target === DoorState.open &&
					[DoorState.open, DoorState.opening]
						.indexOf(this.storedState) >= 0) {
				this.log(`State is already "${DoorState[this.storedState]}". Skipping.`)
			} else {
				// The state is different from stored! Let's push the button!

				// If there is a pending movement callback, cancel it first
				this.cancelMovementCallback()

				// Press the button to get the door moving!
				this.log(`Pressing button`)
				const buttonPress = this.pressButton()

				// Calculate the next state based on the stored current state
				//   and the standard garage movements
				const newState = (() => {
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
						default:
							return this.storedState
					}
				})()

				this.log(`Last state was "${DoorState[this.storedState]}" and predicted state is "${DoorState[newState]}"`)

				let needToWaitForInitialMovement = false

				if ([DoorState.closed, DoorState.open]
						.indexOf(this.storedState) >= 0) {
					needToWaitForInitialMovement = true
				}

				this.storedState = newState

				await buttonPress
				this.log(`Done pressing button`)

				// If the door didn't transition to stopped, we need to wait for
				//   movement to end.
				if (newState !== DoorState.stopped) {
					this.queueMovementCallback()
				}

				if (needToWaitForInitialMovement) {
					this.waitingForInitialMovement = true

					// It sometimes takes a few seconds for the door to start
					//   moving. Wait for that here.
					delay(() => {
						this.waitingForInitialMovement = false
					}, this.config.durationOfMovement / 5)
				}
			}

			this.requestQueue.shift()
			this.processingRequests = this.requestQueue.length > 0
		}
	}

	/**
	 * Queue a new movement callback, cancelling any other pending one.
	 */
	private queueMovementCallback() {
		this.log(`Queueing movement callback`)

		this.cancelMovementCallback()
		this._cancelMovementCallback = delay(() => {
			this.log(`Movement callback called`)
			this.storedState = this.getCalculatedState()
			this._cancelMovementCallback = undefined
		}, this.config.durationOfMovement)
	}

	private async queueRequest(state: TargetState) {
		this.requestQueue.push(state)
		this.log(`A new request for "${DoorState[state]}" was queued`)

		if (this.requestQueue.length === 1) {
			// This will start processing active requests if this is the first
			//   request since the queue was last emptied.
			this.processRequests().catch()
		}
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
function delay(block: () => void, millis = 0): () => void {
	const timer = setTimeout(block, millis)

	return () => {
		clearTimeout(timer)
	}
}

function makeBuffer<T>(length = 4) {
	interface Buffer extends Array<T> {
		readonly predict: T | undefined
	}

	const buffer = new Proxy([] as T[], {
		get(target, prop) {
			if (prop === `unshift`) {
				return function() {
					target.unshift.call(target, ...arguments)

					if (target.length > length) {
						target.length = length
					}
				}
			} else if (prop === `push`) {
				return function() {
					target.push.call(target, ...arguments)

					if (target.length > length) {
						target.splice(0, target.length - length)
					}
				}
			} else {
				return target[prop as keyof typeof target]
			}
		}
	}) as Buffer

	Object.defineProperties(buffer, {
		predict: {
			get(this: Buffer) {
				const predict = this.reduce((trans, next) => {
					const index = trans.findIndex((item) => item[0] === next)

					if (index >= 0) {
						trans[index][1] += 1
					} else {
						trans.push([next, 1])
					}

					return trans
				}, [] as [T, number][])
				.reduce((trans, next) => next[1] > trans[1] ? next : trans)

				if (predict[1] >= 0.75 * this.length) {
					return predict[0]
				}

				return undefined
			}
		}
	})

	return buffer
}
