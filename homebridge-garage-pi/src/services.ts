import { GaragePi } from "./garage-pi"

export let Service: {
	GarageDoorOpener: {
		new(name: string, subtype: string): Has<ItemCharacteristic>
	}

	AccessoryInformation: {
		new(): Has<AccesorryCharacteristic>
	}
}

interface Has<T> {
	getCharacteristic<U>(characteristic: T): MutableCharacteristic<U>
	setCharacteristic<U>(characteristic: T, value: U): Has<T>
}

export interface MutableCharacteristic<T> {
	on(action: 'get', callback: (callback: (error: any, value: T) => void) => void): MutableCharacteristic<T>
	on(action: 'set', callback: (value: T, callback: () => void) => void): MutableCharacteristic<T>
	updateValue(value: T): void

	getValue(): T
	value: T
}

export let Characteristic: CombinedCharacteristics

enum AccesorryCharacteristic {
	// Inherited Characteristics
	Manufacturer,
	Model,
	SerialNumber
}

enum ItemCharacteristic {
	// Required Characteristics
	CurrentDoorState,
	TargetDoorState,
	ObstructionDetected,

	// Optional Characteristics
	LockCurrentState,
	LockTargetState,
	Name
}

type CombinedCharacteristics = typeof AccesorryCharacteristic & typeof ItemCharacteristic

export const Plugin = (homebridge: any) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic

	homebridge.registerAccessory("homebridge-garage-pi", "GaragePi", GaragePi)
}
