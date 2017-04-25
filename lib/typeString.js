/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const util = require("./util");
class TypeString {
    constructor(text) {
        this._parts = text ? this._chunk(text) : [];
    }
    isEmpty() {
        return this._parts.length < 1;
    }
    atomicClassArray() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }
        return parts;
    }
    arrayDereference() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                }
                else {
                    parts.push(part);
                }
            }
        }
        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;
    }
    array() {
        let text;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        }
        else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }
    merge(type) {
        if (!type) {
            return this;
        }
        let parts = util.isString(type) ? this._chunk(type) : type._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }
    nameResolve(nameResolver) {
        let replacer = (match, offset, text) => {
            if (match === 'self' || match === '$this' || match === 'static') {
                return nameResolver.className;
            }
            else if (TypeString._keywords.indexOf(match) >= 0) {
                return match;
            }
            else if (match[0] === '\\') {
                return match.slice(1);
            }
            else {
                return nameResolver.resolveNotFullyQualified(match);
            }
        };
        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }
    toString() {
        return this._parts.join('|');
    }
    _unique(parts) {
        let map = {};
        let part;
        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }
        return Object.keys(map);
    }
    _chunk(typeString) {
        let n = 0;
        let parentheses = 0;
        let parts = [];
        let part = '';
        let c;
        while (n < typeString.length) {
            c = typeString[n];
            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    }
                    else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }
            ++n;
        }
        if (part) {
            parts.push(part);
        }
        return parts;
    }
}
TypeString._classNamePattern = /[$\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff]*/g;
TypeString._keywords = [
    'string', 'integer', 'int', 'boolean', 'bool', 'float',
    'double', 'object', 'mixed', 'array', 'resource',
    'void', 'null', 'false', 'true', 'self', 'static',
    'callable', '$this'
];
exports.TypeString = TypeString;
