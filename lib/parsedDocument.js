/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
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
        this._changeEvent = new types_1.Event();
    }
    get tree() {
        return this._parseTree;
    }
    get uri() {
        return this._textDocument.uri;
    }
    get changeEvent() {
        return this._changeEvent;
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this._parseTree]);
        return traverser.find(predicate);
    }
    textBeforeOffset(offset, length) {
        return this._textDocument.textBeforeOffset(offset, length);
    }
    lineSubstring(offset) {
        return this._textDocument.lineSubstring(offset);
    }
    wordAtOffset(offset) {
        let lineText = this._textDocument.lineSubstring(offset);
        let match = lineText.match(ParsedDocument._wordRegex);
        return match ? match[0] : '';
    }
    flush() {
        this._debounce.flush();
    }
    traverse(visitor) {
        let traverser = new types_1.TreeTraverser([this._parseTree]);
        traverser.traverse(visitor);
        return visitor;
    }
    createTraverser() {
        return new types_1.TreeTraverser([this._parseTree]);
    }
    applyChanges(contentChanges) {
        let change;
        for (let n = 0, l = contentChanges.length; n < l; ++n) {
            change = contentChanges[n];
            this._textDocument.applyEdit(change.range.start, change.range.end, change.text);
        }
        this._debounce.handle(null);
    }
    tokenRange(t) {
        if (!t) {
            return null;
        }
        let r = {
            start: this._textDocument.positionAtOffset(t.offset),
            end: this._textDocument.positionAtOffset(t.offset + t.length)
        };
        return r;
    }
    nodeLocation(node) {
        if (!node) {
            return null;
        }
        let range = this.nodeRange(node);
        if (!range) {
            return null;
        }
        return {
            uri: this.uri,
            range: range
        };
    }
    nodeRange(node) {
        if (!node) {
            return null;
        }
        if (ParsedDocument.isToken(node)) {
            return this.tokenRange(node);
        }
        let tFirst = ParsedDocument.firstToken(node);
        let tLast = ParsedDocument.lastToken(node);
        if (!tFirst || !tLast) {
            return null;
        }
        let range = {
            start: this._textDocument.positionAtOffset(tFirst.offset),
            end: this._textDocument.positionAtOffset(tLast.offset + tLast.length)
        };
        return range;
    }
    tokenText(t) {
        return ParsedDocument.isToken(t) ? this._textDocument.textAtOffset(t.offset, t.length) : '';
    }
    nodeText(node, ignore) {
        if (!node) {
            return '';
        }
        if (ParsedDocument.isToken(node)) {
            return this.tokenText(node);
        }
        let visitor = new ToStringVisitor(this, ignore);
        let traverser = new types_1.TreeTraverser([node]);
        traverser.traverse(visitor);
        return visitor.text;
    }
    createAnonymousName(node) {
        let tFirst = ParsedDocument.firstToken(node);
        let offset = tFirst ? tFirst.offset : 0;
        return `#anonymous#${this.uri}#${offset}`;
    }
    positionAtOffset(offset) {
        return this._textDocument.positionAtOffset(offset);
    }
    offsetAtPosition(position) {
        return this._textDocument.offsetAtPosition(position);
    }
    namespaceNamePhraseToString(node) {
        if (!ParsedDocument.isPhrase(node, [120 /* NamespaceName */])) {
            return '';
        }
        return this.nodeText(node, [159 /* Comment */, 161 /* Whitespace */]);
    }
}
ParsedDocument._wordRegex = /[$a-zA-Z_\x80-\xff][\\a-zA-Z0-9_\x80-\xff]*$/;
exports.ParsedDocument = ParsedDocument;
(function (ParsedDocument) {
    function firstToken(node) {
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
    ParsedDocument.firstToken = firstToken;
    function lastToken(node) {
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
    ParsedDocument.lastToken = lastToken;
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
        return offset > -1 && ParsedDocument.isToken(t) &&
            t.offset <= offset &&
            t.offset + t.length - 1 >= offset;
    }
    ParsedDocument.isOffsetInToken = isOffsetInToken;
    function isOffsetInNode(offset, node) {
        if (!node || offset < 0) {
            return false;
        }
        if (ParsedDocument.isToken(node)) {
            return ParsedDocument.isOffsetInToken(offset, node);
        }
        let tFirst = ParsedDocument.firstToken(node);
        let tLast = ParsedDocument.lastToken(node);
        if (!tFirst || !tLast) {
            return false;
        }
        return tFirst.offset <= offset && tLast.offset + tLast.length - 1 >= offset;
    }
    ParsedDocument.isOffsetInNode = isOffsetInNode;
    function isFixedMemberName(phrase) {
        return ParsedDocument.isPhrase(phrase, [110 /* MemberName */]) &&
            ParsedDocument.isToken(phrase.name, [83 /* Name */]);
    }
    ParsedDocument.isFixedMemberName = isFixedMemberName;
    function isFixedSimpleVariable(phrase) {
        return ParsedDocument.isPhrase(phrase, [155 /* SimpleVariable */]) &&
            ParsedDocument.isToken(phrase.name, [84 /* VariableName */]);
    }
    ParsedDocument.isFixedSimpleVariable = isFixedSimpleVariable;
    function isFixedScopedMemberName(phrase) {
        return ParsedDocument.isPhrase(phrase, [150 /* ScopedMemberName */]) &&
            (ParsedDocument.isToken(phrase.name, [84 /* VariableName */]) ||
                ParsedDocument.isPhrase(phrase.name, [94 /* Identifier */]));
    }
    ParsedDocument.isFixedScopedMemberName = isFixedScopedMemberName;
    const nodeKeys = [
        'tokenType', 'offset', 'length', 'modeStack',
        'phraseType', 'children', 'errors', 'unexpected',
        'numberSkipped'
    ];
    function isNumeric(n) {
        return !isNaN(parseFloat(n)) && isFinite(n);
    }
    function stringyfyReplacer(k, v) {
        return k && !isNumeric(k) && nodeKeys.indexOf(k) < 0 ? undefined : v;
    }
    ParsedDocument.stringyfyReplacer = stringyfyReplacer;
    function firstPhraseOfType(type, nodes) {
        let child;
        for (let n = 0, l = nodes.length; n < l; ++n) {
            child = nodes[n];
            if (child.phraseType === type) {
                return child;
            }
        }
        return null;
    }
    ParsedDocument.firstPhraseOfType = firstPhraseOfType;
    function isNamePhrase(node) {
        if (!node) {
            return false;
        }
        switch (node.phraseType) {
            case 140 /* QualifiedName */:
            case 143 /* RelativeQualifiedName */:
            case 83 /* FullyQualifiedName */:
                return true;
            default:
                return false;
        }
    }
    ParsedDocument.isNamePhrase = isNamePhrase;
})(ParsedDocument = exports.ParsedDocument || (exports.ParsedDocument = {}));
class ParsedDocumentStore {
    constructor() {
        this._bubbleEvent = (args) => {
            this._parsedDocumentChangeEvent.trigger(args);
        };
        this._parsedDocumentmap = {};
        this._parsedDocumentChangeEvent = new types_1.Event();
        this._unsubscribeMap = {};
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
class ToStringVisitor {
    constructor(doc, ignore) {
        this._text = '';
        this._doc = doc;
    }
    get text() {
        return this._text;
    }
    postorder(node, spine) {
        if (ParsedDocument.isToken(node) && (!this._ignore || this._ignore.indexOf(node.tokenType) < 0)) {
            this._text += this._doc.tokenText(node);
        }
    }
}
