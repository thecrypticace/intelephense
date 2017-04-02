/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const php7parser_1 = require("php7parser");
const textDocument_1 = require("./textDocument");
const types_1 = require("./types");
const textDocumentChangeDebounceWait = 250;
class ParsedDocument {
    constructor(uri, text) {
        this._reparse = (x) => {
            this._parseTree = php7parser_1.Parser.parse(this._textDocument.text);
            this._changeEvent.trigger({ parsedDocument: this });
        };
        this._parseTree = php7parser_1.Parser.parse(text);
        this._textDocument = new textDocument_1.TextDocument(uri, text);
        this._debounce = new types_1.Debounce(this._reparse, textDocumentChangeDebounceWait);
    }
    get uri() {
        return this._textDocument.uri;
    }
    get changeEvent() {
        return this._changeEvent;
    }
    flush() {
        this._debounce.flush();
    }
    traverse(visitor) {
        let traverser = new types_1.TreeTraverser([this._parseTree]);
        traverser.traverse(visitor);
    }
    applyChanges(contentChanges) {
        contentChanges.sort(this._textDocumentChangeCompareFn);
        let change;
        for (let n = 0, l = contentChanges.length; n < l; ++n) {
            change = contentChanges[n];
            this._textDocument.applyEdit(change.range.start, change.range.end, change.text);
        }
        this._debounce.handle(null);
    }
    phraseRange(p) {
        let tFirst = this.firstToken(p);
        let tLast = this.lastToken(p);
        if (!tFirst || !tLast) {
            return null;
        }
        return {
            start: this._textDocument.positionAtOffset(tFirst.offset),
            end: this._textDocument.positionAtOffset(tLast.offset + tLast.length)
        };
    }
    firstToken(node) {
        if (ParsedDocument.isToken(node)) {
            return node;
        }
        let t;
        for (let n = 0, l = node.children.length; n < l; ++n) {
            t = this.firstToken(node.children[n]);
            if (t !== null) {
                return t;
            }
        }
        return null;
    }
    lastToken(node) {
        if (ParsedDocument.isToken(node)) {
            return node;
        }
        let t;
        for (let n = node.children.length - 1; n >= 0; --n) {
            t = this.lastToken(node.children[n]);
            if (t !== null) {
                return t;
            }
        }
        return null;
    }
    tokenText(t) {
        return ParsedDocument.isToken(t) ? this._textDocument.textAtOffset(t.offset, t.length) : '';
    }
    namespaceNameToString(node) {
        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }
        let parts = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(this.tokenText(node.parts[n]));
        }
        return parts.join('\\');
    }
    createAnonymousName(node) {
        let range = this.phraseRange(node);
        let suffix = [range.start.line, range.start.character, range.end.line, range.end.character].join('#');
        return '#anonymous#' + suffix;
    }
    positionAtOffset(offset) {
        return this._textDocument.positionAtOffset(offset);
    }
    offsetAtPosition(position) {
        return this._textDocument.offsetAtPosition(position);
    }
    _textDocumentChangeCompareFn(a, b) {
        if (a.range.end.line > b.range.end.line) {
            return -1;
        }
        else if (a.range.end.line < b.range.end.line) {
            return 1;
        }
        else {
            return b.range.end.character - a.range.end.character;
        }
    }
    ;
}
exports.ParsedDocument = ParsedDocument;
(function (ParsedDocument) {
    function isToken(node, types) {
        return node && node.tokenType !== undefined &&
            (!types || types.indexOf(node.tokenType) > -1);
    }
    ParsedDocument.isToken = isToken;
    function isPhrase(node, types) {
        return node && node.phraseType !== undefined &&
            (!types || types.indexOf(node.phraseType) > -1);
    }
    ParsedDocument.isPhrase = isPhrase;
    function isOffsetInToken(offset, t) {
        return ParsedDocument.isToken(t) &&
            t.offset >= this.offset &&
            t.offset <= this.offset;
    }
    ParsedDocument.isOffsetInToken = isOffsetInToken;
})(ParsedDocument = exports.ParsedDocument || (exports.ParsedDocument = {}));
class ParsedDocumentStore {
    constructor() {
        this._bubbleEvent = (args) => {
            this._parsedDocumentChangeEvent.trigger(args);
        };
        this._parsedDocumentmap = {};
        this._parsedDocumentChangeEvent = new types_1.Event();
    }
    get parsedDocumentChangeEvent() {
        return this._parsedDocumentChangeEvent;
    }
    get count() {
        return Object.keys(this._parsedDocumentmap).length;
    }
    has(uri) {
        return this._parsedDocumentmap[uri] !== undefined;
    }
    add(parsedDocument) {
        if (this.has(parsedDocument.uri)) {
            throw new Error('Duplicate key');
        }
        this._parsedDocumentmap[parsedDocument.uri] = parsedDocument;
        this._unsubscribeMap[parsedDocument.uri] = parsedDocument.changeEvent.subscribe(this._bubbleEvent);
    }
    remove(uri) {
        if (!this.has(uri)) {
            return;
        }
        let unsubscribe = this._unsubscribeMap[uri];
        unsubscribe();
        delete this._parsedDocumentmap[uri];
    }
    find(uri) {
        return this._parsedDocumentmap[uri];
    }
}
exports.ParsedDocumentStore = ParsedDocumentStore;
class ContextVisitor {
    constructor(offset) {
        this.offset = offset;
        this.haltTraverse = false;
    }
    get context() {
        return new Context(this._spine, this._namespaceDefinition, this.offset);
    }
    preOrder(node, spine) {
        if (this.haltTraverse) {
            return false;
        }
        if (ParsedDocument.isOffsetInToken(this.offset, node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            return false;
        }
        if (node.phraseType === 118 /* NamespaceDefinition */) {
            this._namespaceDefinition = node;
        }
        return true;
    }
    postOrder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        if (node.phraseType === 118 /* NamespaceDefinition */ &&
            node.statementList) {
            this._namespaceDefinition = undefined;
        }
    }
}
class Context {
    constructor(spine, namespaceDefinition, offset) {
        this._namespaceDefinition = namespaceDefinition;
        this._spine = spine.slice(0);
    }
    get offset() {
        return this._offset;
    }
    get spine() {
        return this._spine.slice(0);
    }
    get namespace() {
        return this._namespaceDefinition;
    }
    get token() {
        return this._spine.length ? this._spine[this._spine.length - 1] : null;
    }
    get traverser() {
        return new types_1.TreeTraverser(this._spine);
    }
}
exports.Context = Context;
