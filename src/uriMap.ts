/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

export var counter = 1;
export var map: { [uri: string]: number } = {};
export const BUILT_IN_SYMBOL_TABLE_URI = 'php';

export function add(uri: string) {

    if(uri === BUILT_IN_SYMBOL_TABLE_URI) {
        return;
    }

    if (map[uri]) {
        throw new Error('Duplicate Key ' + uri);
    }

    map[uri] = counter;
    ++counter;
}

export function remove(uri:string) {
    delete map[uri];
}

export function id(uri: string) {
    if(uri === BUILT_IN_SYMBOL_TABLE_URI) {
        return 0;
    }
    return map[uri];
}

export function uriArray() {
    return Object.keys(map);
}