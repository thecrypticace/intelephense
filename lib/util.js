/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
function popMany(array, count) {
    let popped = [];
    while (count--) {
        popped.push(array.pop());
    }
    return popped.reverse();
}
exports.popMany = popMany;
function top(array) {
    return array.length ? array[array.length - 1] : null;
}
exports.top = top;
function isString(s) {
    return typeof (s) === 'string' || s instanceof String;
}
exports.isString = isString;
function isInRange(position, startRange, endRange) {
    if (position.line < startRange.line ||
        (position.line === startRange.line && position.character < startRange.character)) {
        return -1;
    }
    if (position.line > endRange.line ||
        (position.line === endRange.line && position.character > endRange.character)) {
        return 1;
    }
    return 0;
}
exports.isInRange = isInRange;
function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0;
        let v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
exports.guid = guid;
