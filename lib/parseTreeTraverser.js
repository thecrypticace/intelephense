/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const parsedDocument_1 = require("./parsedDocument");
const util = require("./util");
class ParseTreeTraverser extends types_1.TreeTraverser {
    constructor(document, symbolTable) {
        super([document.tree]);
        this._doc = document;
        this._table = symbolTable;
    }
    get document() {
        return this._doc;
    }
    get symbolTable() {
        return this._table;
    }
    get text() {
        return this._doc.nodeText(this.node);
    }
    get range() {
        return this._doc.nodeRange(this.node);
    }
    get reference() {
        let scope = this.scope;
        let range = this.range;
        if (!scope || !range || !scope.references) {
            return null;
        }
        let ref;
        for (let n = 0; n < scope.references.length; ++n) {
            ref = scope.references[n];
            if (util.isInRange(range.start, ref.location.range) === 0) {
                return ref;
            }
        }
        return null;
    }
    get scope() {
        let range = this.range;
        if (!range) {
            return null;
        }
        return this._table.scope(range.start);
    }
    get nameResolver() {
        let firstToken = parsedDocument_1.ParsedDocument.firstToken(this.node);
        let pos = this.document.positionAtOffset(firstToken.offset);
        return this._table.nameResolver(pos);
    }
    /**
     * Traverses to the token to the left of position
     * @param pos
     */
    position(pos) {
        let offset = this._doc.offsetAtPosition(pos) - 1;
        let fn = (x) => {
            return x.tokenType !== undefined &&
                offset < x.offset + x.length &&
                offset >= x.offset;
        };
        return this.find(fn);
    }
    clone() {
        let spine = this.spine;
        let traverser = new ParseTreeTraverser(this._doc, this._table);
        traverser._spine = spine;
        return traverser;
    }
    /**
     * True if current node is the name part of a declaration
     */
    get isDeclarationName() {
        let traverser = this.clone();
        let t = traverser.node;
        let parent = traverser.parent();
        if (!t || !parent) {
            return false;
        }
        return ((t.tokenType === 83 /* Name */ || t.tokenType === 84 /* VariableName */) && this._isDeclarationPhrase(parent)) ||
            (parent.phraseType === 95 /* Identifier */ && this._isDeclarationPhrase(traverser.parent()));
    }
    _isDeclarationPhrase(node) {
        if (!node) {
            return false;
        }
        switch (node.phraseType) {
            case 30 /* ClassDeclarationHeader */:
            case 167 /* TraitDeclarationHeader */:
            case 105 /* InterfaceDeclarationHeader */:
            case 138 /* PropertyElement */:
            case 43 /* ConstElement */:
            case 129 /* ParameterDeclaration */:
            case 88 /* FunctionDeclarationHeader */:
            case 115 /* MethodDeclarationHeader */:
            case 26 /* ClassConstElement */:
                return true;
            default:
                return false;
        }
    }
}
exports.ParseTreeTraverser = ParseTreeTraverser;
