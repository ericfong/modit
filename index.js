
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var _ = require('underscore');
var Wait = require('wait-async');

var Promise = require('es6-promise').Promise;


// both Action && Store
function Table(name, funcs) {
    this.name = name;
    this.data = {};

    // ops for flush to server or other local database
    // this should be store in local storage if you want the ops survive over client restart
    //this.ops = [];

    // ops for emit as local events
    //this.opsTmp = [];

    this._isSaveQueued = false;
    this._isSaving = false;
    this._isSaveAgain = false;
    this._saveDebounce = 800;

    _.extend(this, funcs);

    this._saveQueue = _.debounce(this._saveLoop, this._saveDebounce);

    Table.instances.push(this);

    if (!Table.dispatcher)
        throw new Error('Please setup singleton flux-dispatcher and set it to Table.dispatcher');
    Table.dispatcher.register(this._onDispatch.bind(this));
}

// Setup dispatcher like this
//Table.dispatcher = Dispatcher;

Table.instances = [];

util.inherits(Table, EventEmitter);
_.extend(Table.prototype, {

    _onDispatch: function(action){
        if (action.table != this.name)
            return;
        console.log(action);
        var refs = this._walk(action.p);
        var obj = refs.obj;
        var key = refs.key;
        if (action.na !== undefined) {
            obj[key] += action.na;


        } else if (action.li !== undefined && action.ld !== undefined) {
            obj[key] = action.li;
        } else if (action.li !== undefined) {
            obj.splice(key, 0, action.li);
        } else if (action.ld !== undefined) {
            obj.splice(key, 1);
        } else if (action.lm !== undefined) {
            var arr = obj.splice(key, 1);
            obj.splice(action.lm, 0, arr[0]);


        } else if (action.oi !== undefined) {
            obj[key] = action.oi;

        } else if (action.od !== undefined) {
            delete obj[key];
        }

        this.emit('modified', action);

        // saving should be background process
        this._isSaveQueued = true;
        this._saveQueue();
    },
    _walk: function(path){
        var obj = this.data;
        var key = path[0];

        if (path.length >= 2) {
            for (var i = 0, ii = path.length - 1; i < ii; i++) {
                var nextObj = obj[key];
                var nextKey = path[i + 1];

                if (!nextObj) {
                    // for easy to use
                    if (i < 1) {
                        nextObj = obj[key] = typeof nextKey == 'number' ? [] : {};
                    } else {
                        console.error('bad path', this, obj, key);
                        throw new Error('bad path '+path.join('/'));
                    }
                }

                obj = nextObj;
                key = nextKey;
            }
        }
        return {obj:obj, key:key};
    },

    _saveLoop: function(){
        if (this._isSaving) {
            this._isSaveAgain = true;
            return;
        }
        this._isSaveQueued = false;
        this._isSaving = true;
        this._isSubmitAgain = false;

        this.doSave(function(){
            this._isSaving = false;
            if (this._isSaveAgain) {
                this._doSave();
            } else {
                this.emit('saved');
            }
        }.bind(this));
    },

    // for override
    doBoot: function(cb){
        cb();
    },
    doSave: function(cb){
        // store data into localStorage
        cb();
    },

    _submit: function(op) {
        op.table = this.name;
        Table.dispatcher.dispatch(op);
    },

    // Object
    set: traverse(function(path, obj, key, value){
        if (obj[key] == value)
            return;

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
    }, 1),

    // Number
    inc: traverse(function(path, obj, key, value){
        var op = {p:path, na:value};
        this._submit(op);
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
    } else if (typeof obj === 'object') {
        op.od = obj[key];

        ret = obj[key];
    } else {
        throw new Error('bad path');
    }
    this._submit(op);
    return ret;
}

function _remove(path, obj, key, len){
    var pos = path.pop();
    for (var i=pos; i<pos+len; i++) {
      this._submit({
        p: path.concat(pos),
        ld: obj[i]
      });
    }

    return [].concat(obj).splice(pos, len);
}

function _insert(path, obj, key, value){
    var op = {p:path};
    if (Array.isArray(obj)) {
        op.li = value;
    } else {
        throw new Error('bad path');
    }
    this._submit(op);
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
        table.doBoot(wait());
    });
    wait.then(function(){
        Table.isBooted = true;
        if (cb) cb();
    });
}

module.exports = Table;
