/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
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

export function acronym(text: string) {

    if (!text) {
        return '';
    }

    let lcText = text.toLowerCase();
    let n = 0;
    let l = text.length;
    let c: string;
    let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';

    while (n < l) {

        c = text[n];

        if ((c === '$' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
            ++n;
            acronym += lcText[n];
        } else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
            //uppercase
            acronym += lcText[n];
        }

        ++n;

    }

    return acronym;
}

export function trigrams(text: string) {

    if (text.length < 3) {
        return new Set<string>();
    }

    //text = text.toLowerCase();
    let trigrams: Set<string> = new Set();

    for (let n = 0, l = text.length - 2; n < l; ++n) {
        trigrams.add(text.substr(n, 3));
    }

    return trigrams;
}

export function fuzzyStringMatch(query: string, subject: string) {
    if (!query) {
        return true;
    }

    query = query.toLowerCase();
    let lcSubject = subject.toLowerCase();

    let substrings = trigrams(query);
    substrings.add(query);

    let iterator = substrings.values();
    let result: IteratorResult<string>;

    while (true) {

        result = iterator.next();

        if (result.done) {
            break;
        } else if (lcSubject.indexOf(result.value) > -1) {
            return true;
        }

    }

    return acronym(subject).indexOf(query) > -1;

}

export function ciStringMatch(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase();
}

export function whitespace(n:number){
    return new Array(n).fill(' ').join('');
}