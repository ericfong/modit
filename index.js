
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var _ = require('underscore');
var Wait = require('wait-async');


function Table(data) {
    this.data = {};

    // ops for flush to server or other local database
    // this should be store in local storage if you want the ops survive over client restart
    this.ops = [];

    // ops for emit as local events
    this.opsTmp = [];

    this._isBooted = false;
    this._isSubmitQueued = false;
    this._isSubmitting = false;
    this._isSubmitAgain = false;
    this._debounceTime = 10;

    _.extend(this, data);

    // use this to make it have similar effect as flux from facebook
    this._doSubmitDelay = _.debounce(this._doSubmit, this._debounceTime);

    Table.instances.push(this);
}
Table.instances = [];
util.inherits(Table, EventEmitter);
_.extend(Table.prototype, {

    boot: function(cb){
        this.bootLocal(function(){
            this.bootRemote(function(){
                this._isBooted = true;
                cb();
            }.bind(this));
        }.bind(this));
    },

    _submit: function(op) {
        console.log(op, this.data[op.p[0]]);
        this.opsTmp.push(op);
        this.ops.push(op);
        this._isSubmitQueued = true;
        this._doSubmitDelay();
    },

    _submits: function(ops) {
        console.log(ops);
        this.opsTmp = this.opsTmp.concat(ops);
        this.ops = this.ops.concat(ops);
        this._isSubmitQueued = true;
        this._doSubmitDelay();
    },

    _doSubmit: function(){
        //if (!this._isBooted) return;
        if (this._isSubmitting) {
            this._isSubmitAgain = true;
            return;
        }
        this._isSubmitQueued = false;
        this._isSubmitting = true;
        this._isSubmitAgain = false;

        var wait = new Wait();
        this.submitLocal(this.opsTmp, wait());
        this.submitRemote(this.opsTmp, wait());
        // also wait for a list of async functions?
        wait.then(function(){
            this._isSubmitting = false;
            if (this._isSubmitAgain) {
                this._doSubmit();
            } else {
                this.emit('modified', this.opsTmp);
                this.opsTmp = [];
            }
        }.bind(this));
    },

    // for override
    bootLocal: function(cb){
        // store data into localStorage
        cb();
    },
    bootRemote: function(cb){
        // ajax post to server
        cb();
    },
    submitLocal: function(ops, cb){
        // store data into localStorage
        cb();
    },
    submitRemote: function(ops, cb){
        // ajax post to server
        cb();
    },

    // Object
    set: traverse(function(path, obj, key, value){
        var op = {p:path};
        if (Array.isArray(obj)) {
            op.li = value;
            if (typeof obj[key] !== 'undefined') {
                op.ld = obj[key];
            }
        } else if (typeof obj === 'object') {
            op.oi = value;
            if (typeof obj[key] !== 'undefined') {
                op.od = obj[key];
            }
        } else {
            throw new Error('bad path');
        }
        this._submit(op);

        obj[key] = value;
    }, 1),

    del: traverse(_del, 0),
    remove: traverse(_remove, 1),

    // Array
    insert: traverse(_insert, 1),
    move: traverse(function(path, obj, key, to){
        var op = {p:path};
        if (Array.isArray(obj)) {
            op.lm = to;
        } else {
            throw new Error('bad path');
        }
        this._submit(op);

        var arr = obj.splice(key, 1);
        obj.splice(to, 0, arr[0]);
    }, 1),

    // Number
    inc: traverse(function(path, obj, key, value){
        var op = {p:path, na:value};
        this._submit(op);
        obj[key] += value;
    }, 1),


    // Extra
    push: traverse(function(path, obj, key, value){
        if (!Array.isArray(obj[key])) {
            throw new Error('bad path');
        }
        var arr = obj[key];
        path.push(arr.length);
        _insert.call(this, path, arr, arr.length, value);
    }, 1),
    pop: traverse(function(path, obj, key, count){
        if (!Array.isArray(obj[key]))
            throw new Error('bad path');
        var arr = obj[key];
        count = count || 1;
        var pos = arr.length - count;
        path.push(pos);
        var ret = _remove.call(this, path, arr, pos, count);
        return ret.length <= 1 ? ret[0] : ret;
    }, 1),
    shift: traverse(function(path, obj, key, count){
        if (!Array.isArray(obj[key]))
            throw new Error('bad path');
        var arr = obj[key];
        count = count || 1;
        var pos = 0;
        path.push(pos);
        var ret = _remove.call(this, path, arr, pos, count);
        return ret.length <= 1 ? ret[0] : ret;
    }, 1),
    unshift: traverse(function(path, obj, key, value){
        if (!Array.isArray(obj[key])) {
            throw new Error('bad path');
        }
        var arr = obj[key];
        path.push(0);
        _insert.call(this, path, arr, 0, value);
    }, 1),
});

function _del(path, obj, key){
    var ret = null;
    var op = {p:path};
    // will not happen
    if (typeof obj[key] === 'undefined') {
        throw new Error('no element at that path');
    }
    if (Array.isArray(obj)) {
        op.ld = obj[key];

        ret = obj[key];
        obj.splice(key, 1);
    } else if (typeof obj === 'object') {
        op.od = obj[key];

        ret = obj[key];
        delete obj[key];
    } else {
        throw new Error('bad path');
    }
    this._submit(op);
    return ret;
}

function _remove(path, obj, key, len){
    var ops = [];
    var pos = path.pop();
    for (var i=pos; i<pos+len; i++) {
      ops.push({
        p: path.concat(pos),
        ld: obj[i]
      });
    }
    this._submits(ops);

    return obj.splice(pos, len);
}

function _insert(path, obj, key, value){
    var op = {p:path};
    if (Array.isArray(obj)) {
        op.li = value;
    } else {
        throw new Error('bad path');
    }
    this._submit(op);

    obj.splice(key, 0, value);
}

function traverse(func, requiredArgsCount) {
    return function(){
        var args = Array.prototype.slice.call(arguments);
        var steps = [];
        while (args.length > requiredArgsCount && (typeof(args[0]) == 'string' || typeof(args[0]) == 'number') ) {
            steps.push( args.shift() );
        }
        if (steps.length == 0)
            throw new Error('no path');

        var obj = this.data;
        var key = steps[0];

        if (steps.length >= 2) {
            for (var i = 0, ii = steps.length - 1; i < ii; i++) {
                var nextObj = obj[key];
                var nextKey = steps[i+1];

                if (!nextObj) {
                    // for easy to use
                    if (i < 1) {
                        nextObj = obj[key] = typeof nextKey == 'number' ? [] : {};
                    } else {
                        console.error('bad path', this, obj, key);
                        throw new Error('bad path '+steps.join('/'));
                    }
                }

                obj = nextObj;
                key = nextKey;
            }
        }

        args.unshift(steps, obj, key);
        return func.apply(this, args);
    }
}
Table.traverse = traverse;

Table.boot = function(cb){
    var wait = new Wait();
    this.instances.forEach(function(table){
        table.boot(wait());
    });
    wait.then(cb);
}

module.exports = Table;
