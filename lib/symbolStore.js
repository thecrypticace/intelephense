/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const types_1 = require("./types");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const typeString_1 = require("./typeString");
const builtInSymbols = require("./builtInSymbols.json");
const symbolReader_1 = require("./symbolReader");
const nameResolver_1 = require("./nameResolver");
const util = require("./util");
const typeAggregate_1 = require("./typeAggregate");
const referenceReader_1 = require("./referenceReader");
class SymbolTable {
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
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get symbolCount() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    get referenceCount() {
        return this.references().length;
    }
    parent(s) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let fn = (x) => {
            return x === s;
        };
        if (!traverser.find(fn)) {
            return null;
        }
        return traverser.parent();
    }
    traverse(visitor) {
        let traverser = new types_1.TreeTraverser([this.root]);
        traverser.traverse(visitor);
        return visitor;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.find(predicate);
    }
    nameResolver(pos) {
        let nameResolver = new nameResolver_1.NameResolver();
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new NameResolverVisitor(pos, nameResolver);
        traverser.traverse(visitor);
        return nameResolver;
    }
    scope(pos) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new ScopeVisitor(pos, false);
        traverser.traverse(visitor);
        return visitor.scope;
    }
    absoluteScope(pos) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new ScopeVisitor(pos, true);
        traverser.traverse(visitor);
        return visitor.scope;
    }
    scopeSymbols() {
        return this.filter(this._isScopeSymbol);
    }
    symbolAtPosition(position) {
        let pred = (x) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };
        return this.filter(pred).pop();
    }
    references(filter) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new ReferencesVisitor(filter);
        traverser.traverse(visitor);
        return visitor.references;
    }
    referenceAtPosition(position) {
        let s = this.scope(position);
        let fn = (ref) => {
            return util.isInRange(position, ref.location.range) === 0;
        };
        return s.references ? util.find(s.references, fn) : undefined;
    }
    contains(identifier) {
        let traverser = new types_1.TreeTraverser([this.root]);
        let visitor = new ContainsVisitor(identifier);
        traverser.traverse(visitor);
        return visitor.found;
    }
    _isScopeSymbol(s) {
        const mask = 1 /* Class */ | 2 /* Interface */ | 4 /* Trait */ | 0 /* None */ | 64 /* Function */ | 32 /* Method */;
        return (s.kind & mask) > 0;
    }
    _hasReferences(s) {
        return s.references !== undefined;
    }
    static create(parsedDocument, externalOnly) {
        let symbolReader = new symbolReader_1.SymbolReader(parsedDocument, new nameResolver_1.NameResolver());
        symbolReader.externalOnly = externalOnly;
        parsedDocument.traverse(symbolReader);
        return new SymbolTable(parsedDocument.uri, symbolReader.symbol);
    }
    static readBuiltInSymbols() {
        return new SymbolTable('php', {
            kind: 0 /* None */,
            name: '',
            children: builtInSymbols
        });
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this.onParsedDocumentChange = (args) => {
            this.remove(args.parsedDocument.uri);
            let table = SymbolTable.create(args.parsedDocument);
            this.add(table);
            referenceReader_1.ReferenceReader.discoverReferences(args.parsedDocument, table, this);
            this.indexReferences(table);
        };
        this._tableIndex = new SymbolTableIndex();
        this._symbolIndex = new NameIndex(this._symbolKeys);
        this._referenceIndex = new NameIndex(this._referenceKeys);
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._tableIndex.find(uri);
    }
    get tableCount() {
        return this._tableIndex.count();
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        this._tableIndex.add(symbolTable);
        this._symbolIndex.addMany(this._indexSymbols(symbolTable.root));
        this._referenceIndex.addMany(symbolTable.references(this._indexableReferenceFilter));
        this._symbolCount += symbolTable.symbolCount;
    }
    remove(uri) {
        let symbolTable = this._tableIndex.remove(uri);
        if (!symbolTable) {
            return;
        }
        this._symbolIndex.removeMany(this._indexSymbols(symbolTable.root));
        this._referenceIndex.removeMany(symbolTable.references(this._indexableReferenceFilter));
        this._symbolCount -= symbolTable.symbolCount;
    }
    indexReferences(symbolTable) {
        let references = symbolTable.references(this._indexableReferenceFilter);
        this._referenceIndex.removeMany(references);
        this._referenceIndex.addMany(references);
    }
    /**
     * Finds all indexed symbols that match text exactly.
     * Case sensitive for constants and variables and insensitive for
     * classes, traits, interfaces, functions, methods
     * @param text
     * @param filter
     */
    find(text, filter) {
        if (!text) {
            return [];
        }
        let lcText = text.toLowerCase();
        let kindMask = 8 /* Constant */ | 256 /* Variable */;
        let result = this._symbolIndex.find(text);
        let symbols = [];
        let s;
        for (let n = 0, l = result.length; n < l; ++n) {
            s = result[n];
            if ((!filter || filter(s)) &&
                (((s.kind & kindMask) > 0 && s.name === text) ||
                    (!(s.kind & kindMask) && s.name.toLowerCase() === lcText))) {
                symbols.push(s);
            }
        }
        return symbols;
    }
    /**
     * Fuzzy matches indexed symbols.
     * Case insensitive
     */
    match(text, filter) {
        if (!text) {
            return [];
        }
        let substrings;
        if (text.length > 3) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
        }
        else {
            substrings = [text];
        }
        let matches = [];
        for (let n = 0; n < substrings.length; ++n) {
            Array.prototype.push.apply(matches, this._symbolIndex.match(substrings[n]));
        }
        if (!filter) {
            return this._sortMatches(text, matches);
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }
        return this._sortMatches(text, filtered);
    }
    findSymbolsByReference(ref, memberMergeStrategy) {
        if (!ref) {
            return [];
        }
        let symbols;
        let fn;
        let lcName;
        let table;
        switch (ref.kind) {
            case 1 /* Class */:
            case 2 /* Interface */:
            case 4 /* Trait */:
                fn = (x) => {
                    return (x.kind & (1 /* Class */ | 2 /* Interface */ | 4 /* Trait */)) > 0;
                };
                symbols = this.find(ref.name, fn);
                break;
            case 64 /* Function */:
            case 8 /* Constant */:
                fn = (x) => {
                    return x.kind === ref.kind;
                };
                symbols = this.find(ref.name, fn);
                if (symbols.length < 1 && ref.altName) {
                    symbols = this.find(ref.altName, fn);
                }
                break;
            case 32 /* Method */:
                lcName = ref.name.toLowerCase();
                fn = (x) => {
                    return x.kind === 32 /* Method */ && x.name.toLowerCase() === lcName;
                };
                symbols = this.findMembers(ref.scope, memberMergeStrategy || 0 /* None */, fn);
                break;
            case 16 /* Property */:
                fn = (x) => {
                    return x.kind === 16 /* Property */ && x.name.slice(1) === ref.name;
                };
                symbols = this.findMembers(ref.scope, memberMergeStrategy || 0 /* None */, fn);
                break;
            case 1024 /* ClassConstant */:
                fn = (x) => {
                    return x.kind === 1024 /* ClassConstant */ && x.name === ref.name;
                };
                symbols = this.findMembers(ref.scope, memberMergeStrategy || 0 /* None */, fn);
                break;
            case 256 /* Variable */:
                table = this._tableIndex.findByIdentifier(ref);
                if (table) {
                    let scope = table.scope(ref.location.range.start);
                    fn = (x) => {
                        return (x.kind & (128 /* Parameter */ | 256 /* Variable */)) > 0 &&
                            x.name === ref.name;
                    };
                    let s = scope.children ? scope.children.find(fn) : null;
                    if (s) {
                        symbols = [s];
                    }
                }
                break;
            case 2048 /* Constructor */:
                fn = (x) => {
                    return x.kind === 32 /* Method */ && x.name.toLowerCase() === '__construct';
                };
                symbols = this.findMembers(ref.name, memberMergeStrategy || 0 /* None */, fn);
                break;
            default:
                break;
        }
        return symbols || [];
    }
    findMembers(scope, memberMergeStrategy, predicate) {
        let fqnArray = typeString_1.TypeString.atomicClassArray(scope);
        let type;
        let members = new Set();
        for (let n = 0; n < fqnArray.length; ++n) {
            type = typeAggregate_1.TypeAggregate.create(this, fqnArray[n]);
            if (type) {
                Set.prototype.add.apply(members, type.members(memberMergeStrategy, predicate));
            }
        }
        return Array.from(members);
    }
    findBaseMember(symbol) {
        if (!symbol || !symbol.scope ||
            !(symbol.kind & (16 /* Property */ | 32 /* Method */ | 1024 /* ClassConstant */)) ||
            (symbol.modifiers & 4 /* Private */) > 0) {
            return symbol;
        }
        let fn;
        if (symbol.kind === 32 /* Method */) {
            let name = symbol.name.toLowerCase();
            fn = (s) => {
                return s.kind === symbol.kind && s.modifiers === symbol.modifiers && name === s.name.toLowerCase();
            };
        }
        else {
            fn = (s) => {
                return s.kind === symbol.kind && s.modifiers === symbol.modifiers && symbol.name === s.name;
            };
        }
        return this.findMembers(symbol.scope, 3 /* Base */, fn).shift() || symbol;
    }
    findOverrides(baseSymbol) {
        if (!baseSymbol ||
            !(baseSymbol.kind & (16 /* Property */ | 32 /* Method */ | 1024 /* ClassConstant */)) ||
            (baseSymbol.modifiers & 4 /* Private */) > 0) {
            return [];
        }
        let baseTypeName = baseSymbol.scope ? baseSymbol.scope : '';
        let baseType = this.find(baseTypeName, symbol_1.PhpSymbol.isClassLike).shift();
        if (!baseType || baseType.kind === 4 /* Trait */) {
            return [];
        }
        let store = this;
        let filterFn = (s) => {
            if (s.kind !== baseSymbol.kind || s.modifiers !== baseSymbol.modifiers || s === baseSymbol) {
                return false;
            }
            let type = store.find(s.scope).shift();
            if (!type) {
                return false;
            }
            if (symbol_1.PhpSymbol.isAssociated(type, baseTypeName)) {
                return true;
            }
            let aggregate = new typeAggregate_1.TypeAggregate(store, type);
            return aggregate.isAssociated(baseTypeName);
        };
        return this.find(baseSymbol.name, filterFn);
    }
    findReferences(name, filter) {
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
    identifierLocation(identifier) {
        let table = this._tableIndex.findByIdentifier(identifier);
        return table ? vscode_languageserver_types_1.Location.create(table.uri, identifier.location.range) : null;
    }
    referenceToTypeString(ref) {
        if (!ref) {
            return '';
        }
        switch (ref.kind) {
            case 1 /* Class */:
            case 2 /* Interface */:
            case 4 /* Trait */:
            case 2048 /* Constructor */:
                return ref.name;
            case 64 /* Function */:
            case 32 /* Method */:
            case 16 /* Property */:
                return this.findSymbolsByReference(ref, 2 /* Documented */).reduce((carry, val) => {
                    return typeString_1.TypeString.merge(carry, symbol_1.PhpSymbol.type(val));
                }, '');
            case 256 /* Variable */:
                return ref.type || '';
            default:
                return '';
        }
    }
    _sortMatches(query, matches) {
        let map = {};
        let s;
        let name;
        let val;
        query = query.toLowerCase();
        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = (symbol_1.PhpSymbol.notFqn(s.name).toLowerCase().indexOf(query) + 1) * 10;
                if (val > 0) {
                    val = 1000 - val;
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
    _classOrInterfaceFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
    _classInterfaceTraitFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */ | 4 /* Trait */)) > 0;
    }
    _indexSymbols(root) {
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(this._indexFilter);
    }
    _indexableReferenceFilter(ref) {
        return ref.kind !== 128 /* Parameter */ && ref.kind !== 256 /* Variable */;
    }
    /**
     * No vars, params or symbols with use modifier or private modifier
     * @param s
     */
    _indexFilter(s) {
        return s.kind !== 128 /* Parameter */ &&
            s.kind !== 256 /* Variable */ &&
            !(s.modifiers & (4096 /* Use */ | 4 /* Private */)) &&
            s.name.length > 0;
    }
    _symbolKeys(s) {
        if (s.kind === 512 /* Namespace */) {
            let lcName = s.name.toLowerCase();
            let keys = new Set();
            keys.add(lcName);
            Set.prototype.add.apply(keys, lcName.split('\\').filter((s) => { return s.length > 0; }));
            return Array.from(keys);
        }
        let notFqn = symbol_1.PhpSymbol.notFqn(s.name);
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
exports.SymbolStore = SymbolStore;
class NameResolverVisitor {
    constructor(pos, nameResolver) {
        this.pos = pos;
        this.nameResolver = nameResolver;
        this.haltTraverse = false;
        this._kindMask = 1 /* Class */ | 64 /* Function */ | 8 /* Constant */;
    }
    preorder(node, spine) {
        if (node.location && node.location.range.start.line > this.pos.line) {
            this.haltTraverse = true;
            return false;
        }
        if ((node.modifiers & 4096 /* Use */) > 0 && (node.kind & this._kindMask) > 0) {
            this.nameResolver.rules.push(node);
        }
        else if (node.kind === 512 /* Namespace */) {
            this.nameResolver.namespace = node;
        }
        else if (node.kind === 1 /* Class */) {
            this.nameResolver.pushClass(node);
        }
        return true;
    }
    postorder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        if (node.kind === 1 /* Class */) {
            this.nameResolver.popClass();
        }
    }
}
class ScopeVisitor {
    constructor(pos, absolute) {
        this.pos = pos;
        this.haltTraverse = false;
        this._kindMask = 1 /* Class */ | 2 /* Interface */ | 4 /* Trait */ | 64 /* Function */ | 32 /* Method */ | 4096 /* File */;
        this._absolute = false;
        this._scopeStack = [];
        this._absolute = absolute;
    }
    get scope() {
        return this._scopeStack[this._scopeStack.length - 1];
    }
    preorder(node, spine) {
        if (node.location && node.location.range.start.line > this.pos.line) {
            this.haltTraverse = true;
            return false;
        }
        if (!node.location || util.isInRange(this.pos, node.location.range) !== 0) {
            return false;
        }
        if ((node.kind & this._kindMask) > 0 &&
            !(node.modifiers & 4096 /* Use */) &&
            (!this._absolute || node.kind !== 64 /* Function */ || !(node.modifiers & 512 /* Anonymous */))) {
            this._scopeStack.push(node);
        }
        return true;
    }
    postorder(node, spine) {
        if (this.haltTraverse) {
            return;
        }
        if ((node.kind & this._kindMask) > 0 && this._scopeStack.length > 1) {
            this._scopeStack.pop();
        }
    }
}
class ReferencesVisitor {
    constructor(filter) {
        this._filter = filter;
        this._refs = [];
    }
    get references() {
        return this._refs;
    }
    preorder(node, spine) {
        if (!node.references) {
            return true;
        }
        if (this._filter) {
            let r;
            for (let n = 0; n < node.references.length; ++n) {
                r = node.references[n];
                if (this._filter(r)) {
                    this._refs.push(r);
                }
            }
        }
        else {
            Array.prototype.push.apply(this._refs, node.references);
        }
        return true;
    }
}
class ContainsVisitor {
    constructor(identifier) {
        this.haltTraverse = false;
        this.found = false;
        this._identifier = identifier;
        if (!identifier.location) {
            throw new Error('Invalid Argument');
        }
    }
    preorder(node, spine) {
        if (node === this._identifier) {
            this.found = true;
            this.haltTraverse = true;
            return false;
        }
        if (node.location && util.isInRange(this._identifier.location.range.start, node.location.range) !== 0) {
            return false;
        }
        if (node.references && node.references.indexOf(this._identifier) > -1) {
            this.found = true;
            this.haltTraverse = true;
            return false;
        }
        return true;
    }
}
class NameIndex {
    constructor(keysDelegate) {
        this._keysDelegate = keysDelegate;
        this._nodeArray = [];
        this._binarySearch = new types_1.BinarySearch(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }
    add(item) {
        let suffixes = this._keysDelegate(item);
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
        let suffixes = this._keysDelegate(item);
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
    /**
     * Matches all items that are prefixed with text
     * @param text
     */
    match(text) {
        text = text.toLowerCase();
        let nodes = this._nodeMatch(text);
        let matches = new Set();
        for (let n = 0; n < nodes.length; ++n) {
            Set.prototype.add.apply(matches, nodes[n].items);
        }
        return Array.from(matches);
    }
    /**
     * Finds all items that match (case insensitive) text exactly
     * @param text
     */
    find(text) {
        let node = this._nodeFind(text.toLowerCase());
        return node ? node.items : [];
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
    _nodeFind(lcText) {
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
}
class SymbolTableIndex {
    constructor() {
        this._count = 0;
        this._tables = [];
        this._search = new types_1.BinarySearch(this._tables);
    }
    count() {
        return this._count;
    }
    add(table) {
        let fn = this._createCompareFn(table.uri);
        let search = this._search.search(fn);
        if (search.isExactMatch) {
            let node = this._tables[search.rank];
            if (node.tables.find(this._createUriFindFn(table.uri))) {
                --this._count;
                throw new Error(`Duplicate key ${table.uri}`);
            }
            node.tables.push(table);
        }
        else {
            let node = { hash: table.hash, tables: [table] };
            this._tables.splice(search.rank, 0, node);
        }
        ++this._count;
    }
    remove(uri) {
        let fn = this._createCompareFn(uri);
        let node = this._search.find(fn);
        if (node) {
            let i = node.tables.findIndex(this._createUriFindFn(uri));
            if (i > -1) {
                --this._count;
                return node.tables.splice(i, 1).pop();
            }
        }
    }
    find(uri) {
        let fn = this._createCompareFn(uri);
        let node = this._search.find(fn);
        return node ? node.tables.find(this._createUriFindFn(uri)) : null;
    }
    findByIdentifier(i) {
        if (!i.location) {
            return null;
        }
        let node = this._search.find((x) => {
            return x.hash - i.location.uriHash;
        });
        if (!node || !node.tables.length) {
            return null;
        }
        else if (node.tables.length === 1) {
            return node.tables[0];
        }
        else {
            let table;
            for (let n = 0; n < node.tables.length; ++n) {
                table = node.tables[n];
                if (table.contains(i)) {
                    return table;
                }
            }
        }
        return null;
    }
    _createCompareFn(uri) {
        let hash = util.hash32(uri);
        return (x) => {
            return x.hash - hash;
        };
    }
    _createUriFindFn(uri) {
        return (x) => {
            return x.uri === uri;
        };
    }
}
