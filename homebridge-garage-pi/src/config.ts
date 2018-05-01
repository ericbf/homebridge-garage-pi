export interface Config {
	// Preset values

	/**
	 * The accessory key
	 */
	readonly accessory: "GaragePi",

	// Required values

	/**
	 * Required. This is name of the accessory. This shows up in the Home app on
	 *   the device.
	 */
	name: string

	/**
	 * Required. This is GPIO pin that the garage control button relay is
	 *   connected to. When the GPIO pin outputs HIGH, the relay should close.
	 */
	buttonPin: number

	/**
	 * Required. This is GPIO pin to which the open sensor is connected. When it
	 *   reads HIGH, the door is open.
	 */
	openSensorPin: number

	/**
	 * Required. This is GPIO pin to which the closed sensor is connected. When
	 *   it reads HIGH, the door is closed.
	 */
	closedSensorPin: number

	/**
	 * Required. This is amount of time in milliseconds that it takes the door
	 *   to go from completely open to completely closed, or vise versa.
	 */
	durationOfMovement: number

	// Optional values

	/**
	 * Optional. This is GPIO pin that provides power to both the open and
	 *   closed sensors. It will provide power only when reading the sensors,
	 *   and will push LOW otherwise.
	 */
	sensorPowerPin: number | undefined
	/**
	 * Optional. Defaults to `100`. This is the interval in milliseconds at
	 *   which the system should query for changes, either button presses or
	 *   state changes. It queries the sensors on this interval.
	 */
	pollingInterval: number

	/**
	 * Optional. Defaults to `500`. This is the duration in milliseconds that
	 *   the garage button relay should be closed, simulating the button press.
	 *   This allows for systems that need longer presses to still work.
	 */
	durationToPressButton: number
}
