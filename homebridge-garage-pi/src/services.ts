import { GaragePi } from "./garage-pi"

export let Service: {
	AccessoryInformation: new() => Has<AccesorryCharacteristic>
	GarageDoorOpener: new(name: string, subtype: string) => Has<ItemCharacteristic>
}

export interface Has<T> {
	getCharacteristic<U>(characteristic: T): MutableCharacteristic<U>
	setCharacteristic<U>(characteristic: T, value: U): Has<T>
}

export interface MutableCharacteristic<T> {
	value: T

	getValue(): T
	on(action: `get`, callback: (callback: (error: Error | undefined, value: T) => void) => void): MutableCharacteristic<T>
	on(action: `set`, callback: (value: T, callback: () => void) => void): MutableCharacteristic<T>
	updateValue(value: T): void
}

export let Characteristic: CombinedCharacteristics

export enum AccesorryCharacteristic {
	// Inherited Characteristics
	Manufacturer,
	Model,
	SerialNumber
}

export enum ItemCharacteristic {
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

interface Homebridge {
	hap: {
		Characteristic: typeof Characteristic
		Service: typeof Service
	}

	registerAccessory<T>(key: string, name: string, type: T): void
}

export const Plugin = (homebridge: Homebridge) => {
	Service = homebridge.hap.Service
	Characteristic = homebridge.hap.Characteristic

	homebridge.registerAccessory(`homebridge-garage-pi`, `GaragePi`, GaragePi)
}
