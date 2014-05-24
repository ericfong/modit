About
-----

Modit is offline-first Simplest Model-only System for ReactJs

Modit can be Store for reactjs/flux.



Why not flux?
-------------

Flux defines the dispatcher but the store are on your own.

This module helps you to structure how to handle local and remote when boot, save, update code.



Inspired by
-----------
- https://github.com/share/ottypes/wiki/JSON-operations
- React flux



How to use
----------

    window.S = new Modit({
        bootLocal: function(cb){
            var data = JSON.fromJson( localStorage.getItem('Setting') );
            _.extend(this.data, data);

            // Sync init

            $.get('setting.json', function(data){
                _.extend(this.data, data);
                cb();
            });
        },
        submitLocal: function(ops, cb){
            localStorage.setItem('Setting', JSON.stringify(this.data) );
            cb();
        },

        // other functions
        deviceId: function(){
            return this.data.deviceId;
        },
    });
