/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
class ParseTree {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
}
exports.ParseTree = ParseTree;
(function (ParseTree) {
    function tokenRange(node) {
        return [firstToken(node), lastToken(node)];
    }
    ParseTree.tokenRange = tokenRange;
    function firstToken(node) {
        if (node.tokenType !== undefined) {
            return node;
        }
        let t;
        for (let n = 0, l = node.children.length; n < l; ++n) {
            t = firstToken(node.children[n]);
            if (t !== null) {
                return t;
            }
        }
        return null;
    }
    ParseTree.firstToken = firstToken;
    function lastToken(node) {
        if (node.tokenType !== undefined) {
            return node;
        }
        let t;
        for (let n = node.children.length - 1; n >= 0; --n) {
            t = lastToken(node.children[n]);
            if (t !== null) {
                return t;
            }
        }
        return null;
    }
    ParseTree.lastToken = lastToken;
})(ParseTree = exports.ParseTree || (exports.ParseTree = {}));
class ParseTreeStore {
    constructor() {
        this._map = {};
    }
    add(parseTree) {
        this._map[parseTree.uri] = parseTree;
    }
    remove(uri) {
        delete this._map[uri];
    }
    getParsedDocument(uri) {
        return this._map[uri];
    }
}
exports.ParseTreeStore = ParseTreeStore;
