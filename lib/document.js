/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
class TextDocument {
    constructor(uri, text) {
        this._uri = uri;
        this.fullText = text;
    }
    get uri() {
        return this._uri;
    }
    get fullText() {
        return this._text;
    }
    set fullText(text) {
        this._text = text;
        this._lineOffsets = this._textLineOffsets(text, 0);
    }
    get lineOffsets() {
        return this._lineOffsets;
    }
    offsetAtLine(line) {
        if (line <= 0 || this._lineOffsets.length < 1) {
            return 0;
        }
        else if (line > this._lineOffsets.length - 1) {
            return this._lineOffsets[this._lineOffsets.length - 1];
        }
        else {
            return this._lineOffsets[line];
        }
    }
    textAtOffset(offset, length) {
        return this._text.substr(offset, length);
    }
    positionAtOffset(offset) {
        let search = new types_1.BinarySearch(this._lineOffsets);
        let compareFn = (x) => {
            return offset - x;
        };
        let rank = search.rank(compareFn);
        let index = Math.max(rank - 1, 0);
        return {
            line: index,
            character: offset - this._lineOffsets[index]
        };
    }
    offsetAtPosition(pos) {
        let offset = this.offsetAtLine(pos.line) + pos.character;
        return Math.max(0, Math.min(offset, this._text.length));
    }
    applyEdit(start, end, text) {
        let startOffset = this.offsetAtPosition(start);
        let endOffset = this.offsetAtPosition(end);
        this._text = this._text.slice(0, startOffset) + text + this._text.slice(endOffset);
        let newLineOffsets = this._lineOffsets.slice(0, start.line + 1);
        Array.prototype.push.apply(newLineOffsets, this._textLineOffsets(text, startOffset).slice(1));
        Array.prototype.push.apply(newLineOffsets, this._lineOffsets.slice(end.line + 1));
        this._lineOffsets = newLineOffsets;
        let lengthDiff = text.length - (endOffset - startOffset);
        for (let n = end.line + 1, l = this._lineOffsets.length; n < l; ++n) {
            this._lineOffsets[n] += lengthDiff;
        }
    }
    _textLineOffsets(text, offset) {
        let n = 0;
        let length = text.length;
        let isLineStart = true;
        let offsets = [];
        let c;
        while (n < length) {
            c = text[n];
            if (isLineStart) {
                offsets.push(n + offset);
                isLineStart = false;
            }
            if (c === '\r') {
                if (++n < length && text[n] === '\n') {
                    ++n;
                }
                isLineStart = true;
                continue;
            }
            else if (c === '\n') {
                isLineStart = true;
            }
            ++n;
        }
        if (isLineStart) {
            offsets.push(n + offset);
        }
        return offsets;
    }
}
exports.TextDocument = TextDocument;
class DocumentStore {
    constructor() {
        this._documents = {};
    }
    add(doc) {
        this._documents[doc.uri] = doc;
    }
    remove(uri) {
        delete this._documents[uri];
    }
    find(uri) {
        return this._documents[uri] ? this._documents[uri] : null;
    }
}
exports.DocumentStore = DocumentStore;
