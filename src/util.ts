/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position } from 'vscode-languageserver-types';

export function popMany<T>(array: T[], count: number) {
    let popped: T[] = [];
    while (count--) {
        popped.push(array.pop());
    }
    return popped.reverse();
}

export function top<T>(array: T[]) {
    return array.length ? array[array.length - 1] : null;
}

export function isString(s: any) {
    return typeof (s) === 'string' || s instanceof String;
}

export function isInRange(position: Position, startRange: Position, endRange: Position) {

    if(position.line < startRange.line || 
        (position.line === startRange.line && position.character < startRange.character)){
            return -1;
        }

    if(position.line > endRange.line || 
        (position.line === endRange.line && position.character > endRange.character)){
            return 1;
        }

    return 0;

}

export function guid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        let r = Math.random()*16|0;
        let v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}