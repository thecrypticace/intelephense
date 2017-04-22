/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {NameResolver} from './nameResolver';
import * as util from './util';
import {SymbolKind} from './symbol';

export class TypeString {

    private static _classNamePattern: RegExp = /[$\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff]*/g;

    private static _keywords: string[] = [
        'string', 'integer', 'int', 'boolean', 'bool', 'float',
        'double', 'object', 'mixed', 'array', 'resource',
        'void', 'null', 'false', 'true', 'self', 'static',
        'callable', '$this'
    ];

    private _parts: string[];

    constructor(text: string) {
        this._parts = text ? this._chunk(text) : [];
    }

    isEmpty() {
        return this._parts.length < 1;
    }

    atomicClassArray() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }

        return parts;

    }

    arrayDereference() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];

            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                } else {
                    parts.push(part);
                }

            }

        }

        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;

    }

    array() {
        let text: string;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        } else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }

    merge(type: string | TypeString) {

        if (!type) {
            return this;
        }

        let parts = util.isString(type) ? this._chunk(<string>type) : (<TypeString>type)._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }

    nameResolve(nameResolver: NameResolver) {

        let replacer = (match, offset, text) => {

            if (match === 'self' || match === '$this' || match === 'static') {
                return nameResolver.className;
            } else if (TypeString._keywords.indexOf(match) >= 0) {
                return match;
            } else if (match[0] === '\\') {
                return match.slice(1);
            } else {
                return nameResolver.resolveNotFullyQualified(match, SymbolKind.Class);
            }

        };

        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }

    toString() {
        return this._parts.join('|');
    }

    private _unique(parts: string[]) {
        let map: { [index: string]: string } = {};
        let part: string;

        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }

        return Object.keys(map);
    }

    private _chunk(typeString: string) {

        let n = 0;
        let parentheses = 0;
        let parts: string[] = [];
        let part: string = '';
        let c: string;

        while (n < typeString.length) {

            c = typeString[n];

            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    } else if (part) {
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