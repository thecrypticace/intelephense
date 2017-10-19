/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const util = require("./util");
var Reference;
(function (Reference) {
    function create(kind, name, location) {
        return {
            kind: kind,
            name: name,
            location: location
        };
    }
    Reference.create = create;
})(Reference = exports.Reference || (exports.Reference = {}));
class ReferenceTable {
    constructor(uri, root) {
        this._uri = uri;
        this._root = root;
        this._hash = util.hash32(uri);
    }
    get uri() {
        return this._uri;
    }
    get root() {
        return this._root;
    }
    get hash() {
        return this._hash;
    }
    get referenceCount() {
        return this.references().length;
    }
    references(filter) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new ReferencesVisitor(filter);
        traverser.traverse(visitor);
        return visitor.references;
    }
    referenceAtPosition(position) {
    }
}
exports.ReferenceTable = ReferenceTable;
class ReferenceStore {
    constructor() {
        this._refIndex = new types_1.NameIndex((x) => { return x.identifiers; });
        this._tables = [];
    }
    getReferenceTable(uri) {
        for (let n = 0; n < this._tables.length; ++n) {
            if (this._tables[n].uri === uri) {
                return this._tables[n];
            }
        }
        return undefined;
    }
    add(table) {
    }
    remove(uri, purge) {
    }
    close(uri) {
    }
    closeAll() {
    }
    find(name, filter) {
        if (!name) {
            return [];
        }
        let matches = this._referenceIndex.find(name);
        let filtered = [];
        let match;
        const caseSensitiveKindMask = 16 /* Property */ | 256 /* Variable */ | 8 /* Constant */ | 1024 /* ClassConstant */;
        for (let n = 0; n < matches.length; ++n) {
            match = matches[n];
            if (!filter || filter(match)) {
                if (!(match.kind & caseSensitiveKindMask) || name === match.name) {
                    filtered.push(match);
                }
            }
        }
        return filtered;
    }
    _indexableReferenceFilter(ref) {
        return ref.kind !== 128 /* Parameter */ && ref.kind !== 256 /* Variable */;
    }
    _referenceKeys(ref) {
        let lcName = ref.name.toLowerCase();
        let keys = [lcName];
        if (ref.altName) {
            let lcAlt = ref.altName.toLowerCase();
            if (lcAlt !== lcName && lcAlt !== 'static' && lcAlt !== 'self' && lcAlt !== 'parent') {
                keys.push(lcAlt);
            }
        }
        return keys;
    }
}
exports.ReferenceStore = ReferenceStore;
class ReferencesVisitor {
    constructor(filter) {
        this._filter = filter;
        this._refs = [];
    }
    get references() {
        return this._refs;
    }
    preorder(node, spine) {
        if (node.kind !== undefined && (!this._filter || this._filter(node))) {
            this._refs.push(node);
        }
        return true;
    }
}
