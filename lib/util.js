/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
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
function acronym(text) {
    if (!text) {
        return '';
    }
    let lcText = text.toLowerCase();
    let n = 0;
    let l = text.length;
    let c;
    let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';
    while (n < l) {
        c = text[n];
        if ((c === '$' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
            ++n;
            acronym += lcText[n];
        }
        else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
            //uppercase
            acronym += lcText[n];
        }
        ++n;
    }
    return acronym;
}
exports.acronym = acronym;
function trigrams(text) {
    if (text.length < 3) {
        return new Set();
    }
    //text = text.toLowerCase();
    let trigrams = new Set();
    for (let n = 0, l = text.length - 2; n < l; ++n) {
        trigrams.add(text.substr(n, 3));
    }
    return trigrams;
}
exports.trigrams = trigrams;
function fuzzyStringMatch(query, subject) {
    if (!query) {
        return true;
    }
    query = query.toLowerCase();
    let lcSubject = subject.toLowerCase();
    let substrings = trigrams(query);
    substrings.add(query);
    let iterator = substrings.values();
    let result;
    while (true) {
        result = iterator.next();
        if (result.done) {
            break;
        }
        else if (lcSubject.indexOf(result.value) > -1) {
            return true;
        }
    }
    return acronym(subject).indexOf(query) > -1;
}
exports.fuzzyStringMatch = fuzzyStringMatch;
function ciStringMatch(a, b) {
    return a.toLowerCase() === b.toLowerCase();
}
exports.ciStringMatch = ciStringMatch;
function whitespace(n) {
    return new Array(n).fill(' ').join('');
}
exports.whitespace = whitespace;
