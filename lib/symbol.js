/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const util = require("./util");
var PhpSymbol;
(function (PhpSymbol) {
    function isParameter(s) {
        return s.kind === 128 /* Parameter */;
    }
    function signatureString(s) {
        if (!s || !(s.kind & (64 /* Function */ | 32 /* Method */))) {
            return '';
        }
        let params = s.children ? s.children.filter(isParameter) : [];
        let paramStrings = [];
        let param;
        let parts;
        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];
            if (n) {
                parts.push(',');
            }
            if (param.type && !param.type.isEmpty()) {
                parts.push(param.type.toString());
            }
            parts.push(param.name);
            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            }
            else {
                paramStrings.push(parts.join(' '));
            }
        }
        let sig = `(${paramStrings.join('')})`;
        if (s.type && !s.type.isEmpty()) {
            sig += `: ${s.type}`;
        }
        return sig;
    }
    PhpSymbol.signatureString = signatureString;
    function hasParameters(s) {
        return s.children && s.children.find(isParameter) !== undefined;
    }
    PhpSymbol.hasParameters = hasParameters;
    function notFqn(text) {
        if (!text) {
            return text;
        }
        let pos = text.lastIndexOf('\\') + 1;
        return text.slice(pos);
    }
    PhpSymbol.notFqn = notFqn;
    /**
     * Shallow clone
     * @param s
     */
    function clone(s) {
        return {
            kind: s.kind,
            name: s.name,
            children: s.children,
            location: s.location,
            modifiers: s.modifiers,
            associated: s.associated,
            type: s.type,
            typeSource: s.typeSource,
            description: s.description,
            scope: s.scope,
            value: s.value
        };
    }
    PhpSymbol.clone = clone;
})(PhpSymbol = exports.PhpSymbol || (exports.PhpSymbol = {}));
class SymbolIndex {
    constructor() {
        this._nodeArray = [];
        this._binarySearch = new types_1.BinarySearch(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }
    add(item) {
        let suffixes = this._symbolKeys(item);
        let node;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (node) {
                node.items.push(item);
            }
            else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }
    }
    addMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }
    remove(item) {
        let suffixes = this._symbolKeys(item);
        let node;
        let i;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }
            i = node.items.indexOf(item);
            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    //uneccessary? save a lookup and splice
                    //this._deleteNode(node);
                }
            }
        }
    }
    removeMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }
    match(text, fuzzy) {
        text = text.toLowerCase();
        let substrings;
        if (fuzzy) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
        }
        else {
            substrings = [text];
        }
        let nodes = [];
        for (let n = 0, l = substrings.length; n < l; ++n) {
            Array.prototype.push.apply(nodes, this._nodeMatch(text));
        }
        let matches = [];
        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }
        if (fuzzy) {
            return this._sortedFuzzyResults(text, matches);
        }
        else {
            return Array.from(new Set(matches));
        }
    }
    _sortedFuzzyResults(query, matches) {
        let map = {};
        let s;
        let name;
        let checkIndexOf = query.length > 3;
        let val;
        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = 0;
                if (checkIndexOf) {
                    val = (PhpSymbol.notFqn(s.name).indexOf(query) + 1) * -10;
                    if (val < 0) {
                        val += 1000;
                    }
                }
                map[name] = val;
            }
            ++map[name];
        }
        let unique = Array.from(new Set(matches));
        let sortFn = (a, b) => {
            return map[b.name] - map[a.name];
        };
        unique.sort(sortFn);
        return unique;
    }
    _nodeMatch(lcText) {
        let collator = this._collator;
        let compareLowerFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        };
        return this._binarySearch.range(compareLowerFn, compareUpperFn);
    }
    _nodeFind(text) {
        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        return this._binarySearch.find(compareFn);
    }
    _insertNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        this._nodeArray.splice(rank, 0, node);
    }
    _deleteNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }
    }
    _symbolKeys(s) {
        if (s.kind === 512 /* Namespace */) {
            return this._namespaceSymbolKeys(s);
        }
        let notFqnPos = s.name.lastIndexOf('\\') + 1;
        let notFqn = s.name.slice(notFqnPos);
        let lcNotFqn = notFqn.toLowerCase();
        let lcFqn = s.name.toLowerCase();
        let keys = util.trigrams(lcNotFqn);
        if (lcNotFqn) {
            keys.add(lcNotFqn);
        }
        keys.add(lcFqn);
        let acronym = util.acronym(notFqn);
        if (acronym.length > 1) {
            keys.add(acronym);
        }
        return Array.from(keys);
    }
    _hasLength(text) {
        return text.length > 0;
    }
    _namespaceSymbolKeys(s) {
        if (!s.name) {
            return [];
        }
        let lcName = s.name.toLowerCase();
        let keys = [lcName];
        Array.prototype.push.apply(keys, lcName.split('\\').filter(this._hasLength));
        return keys;
    }
}
exports.SymbolIndex = SymbolIndex;
