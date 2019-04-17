# Automated Garage Door

Eric Ferreira, &lt;2483476+ericbf@users.noreply.github.com&gt;  

#### About this project

The goal of this project was to automate the garage door at my house using tools that I could put together at home, as opposed to buying an enterprise solution. I chose to use a raspberry pi because it is powerful enough to run the server, but small enough to not take up too much space in my garage. I chose to use `homebridge` as my accessory server because it integrates directly with my devices (iOS devices) without having to deal with manual port forwarding or other networking issues.

I developed my custom accessory for `homebridge` using `typescript`, as opposed to every other `accessory` that I saw: they each just used plain `javascript`. `Typescript` enables the developer to use strong typing, generic types, and many other useful and powerful features in a language that transpiles to working `javascript`. My build script (`npm run build`) transpiles the `ts` files to the expected `js` files, maintaining the advanced functionality of `ts` while supporting the less advanced framework of `js`.

## Files

* `README.md`: this file; contains some helpful information about the project.
* `homebridge.service`: start-up script that will run the homebridge server on startup on the raspberry pi.
* `homebridge`: configuration file for the start-up script.
* `homebridge-garage-pi/*`: the development files and resources.
* `config.json`: the configuration file for the homebridge server.

#### How to build

To build the dist archive, `cd` to the `homebridge-garage-pi` directory and run `npm run build`. That will package all the compiled code and the `package.json` into `dist.zip`.

### How to run

To run this project on your own, you need to:

1. Install `homebridge` on your raspberry pi
2. Copy the files to the appropriate directories
	* Copy `homebridge.service` to `/etc/systemd/system/`
	* Copy `homebridge` to `/etc/default/`
	* Copy `homebridge-garage-pi/dist.zip` to `/var/lib/homebridge/custom-accessories/homebridge-garage-pi/` and extract it and run `npm i --prod` there. You can then delete `dist.zip`.
	* Copy `config.json` to `/var/lib/homebridge/`
3. Enable the `homebridge` service using `systemctl`
4. Optionally see the `homebridge` logs with `journalctl`

## References

[1] A. Mustajab, "How to control GPIO pins and operate relays with the Raspberry Pi", *opensource.com*, 2017. [Online]. Available: <https://opensource.com/article/17/3/operate-relays-control-gpio-pins-raspberry-pi>  
[2] C. Baylor, "How to Replace Wall Switch to a Garage Door Opener", *Homeguides.sfgate.com*. [Online]. Available: <http://homeguides.sfgate.com/replace-wall-switch-garage-door-opener-53104.html>  
[3] K. Tian, "nfarina/homebridge", *GitHub*, 2018. [Online]. Available: <https://github.com/nfarina/homebridge> [Accessed: 14-Feb-2018]  
[4] S. Monk, "Adafruit's Raspberry Pi Lesson 12. Sensing Movement", *Learn.adafruit.com*, 2018. [Online]. Available: <https://learn.adafruit.com/adafruits-raspberry-pi-lesson-12-sensing-movement?view=all>  
[5] F. Barthelet, "How To Make Siri your Perfect Home Companion With Devices not Supported by Apple Homekit - Theodo", *Theodo*. [Online]. Available: <https://blog.theodo.fr/2017/08/make-siri-perfect-home-companion-devices-not-supported-apple-homekit/> [Accessed: 10-Apr-2018]  
[6] "KhaosT/HAP-NodeJS", *GitHub*. [Online]. Available: <https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js> [Accessed: 10-Apr-2018]
