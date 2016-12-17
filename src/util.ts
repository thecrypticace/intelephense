/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

export function popMany(array: any[], count: number) {
    let popped: any[] = [];
    while (count--) {
        popped.push(array.pop());
    }
    return popped.reverse();
}

export function top(array: any) {
    return array.length ? array[array.length - 1] : null;
}

export function isString(s:string){
    return typeof(s) === 'string' || s instanceof String;
}