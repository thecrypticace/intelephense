/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const types_1 = require("./types");
const typeString_1 = require("./typeString");
const builtInSymbols = require("./builtInSymbols.json");
const symbolReader_1 = require("./symbolReader");
const nameResolver_1 = require("./nameResolver");
class SymbolTable {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get count() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.find(predicate);
    }
    symbolAtPosition(position) {
        let pred = (x) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };
        return this.filter(pred).pop();
    }
    static create(parsedDocument, externalOnly) {
        let symbolReader = new symbolReader_1.SymbolReader(parsedDocument, new nameResolver_1.NameResolver(), [{ kind: 0 /* None */, name: '', children: [] }]);
        symbolReader.externalOnly = externalOnly;
        parsedDocument.traverse(symbolReader);
        return new SymbolTable(parsedDocument.uri, symbolReader.spine[0]);
    }
    static readBuiltInSymbols() {
        SymbolTable.builtInSymbolTypeStrings(builtInSymbols);
        return new SymbolTable('\\', {
            kind: 0 /* None */,
            name: '',
            children: builtInSymbols
        });
    }
    static builtInSymbolTypeStrings(symbols) {
        let s;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            s = symbols[n];
            if (s.type) {
                s.type = new typeString_1.TypeString(s.type);
            }
            if (s.children) {
                SymbolTable.builtInSymbolTypeStrings(s.children);
            }
        }
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this.onParsedDocumentChange = (args) => {
            this.remove(args.parsedDocument.uri);
            this.add(SymbolTable.create(args.parsedDocument));
        };
        this._map = {};
        this._index = new symbol_1.SymbolIndex();
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._map[uri];
    }
    get tableCount() {
        return Object.keys(this._map).length;
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }
    remove(uri) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }
    /**
     * As per match but returns first item in result that matches text exactly
     * @param text
     * @param kindMask
     */
    find(text, filter) {
        let exactMatchFn = (x) => {
            return (!filter || filter(x)) && x.name === text;
        };
        return this.match(text, exactMatchFn).shift();
    }
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text, filter, fuzzy) {
        if (!text) {
            return [];
        }
        let matched = this._index.match(text, fuzzy);
        if (!filter) {
            return matched;
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }
        return filtered;
    }
    _classOrInterfaceFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
    lookupTypeMembers(query) {
        let type = this.find(query.typeName, this._classOrInterfaceFilter);
        return this._lookupTypeMembers(type, query.memberPredicate, []);
    }
    lookupTypeMember(query) {
        return this.lookupTypeMembers(query).shift();
    }
    lookupMembersOnTypes(queries) {
        let symbols = [];
        for (let n = 0, l = queries.length; n < l; ++n) {
            Array.prototype.push.apply(symbols, this.lookupTypeMembers(queries[n]));
        }
        return symbols;
    }
    lookupMemberOnTypes(queries) {
        return this.lookupMembersOnTypes(queries).shift();
    }
    /**
     * This will return duplicate symbols where members are overridden or already implemented
     * @param type
     * @param predicate
     * @param typeHistory
     */
    _lookupTypeMembers(type, predicate, typeHistory) {
        if (!type || typeHistory.indexOf(type.name) > -1) {
            return [];
        }
        //prevent cyclical lookup
        typeHistory.push(type.name);
        let members = type.children ? type.children.filter(predicate) : [];
        if (!type.associated) {
            return members;
        }
        //lookup in base class/traits
        let baseMemberPredicate = (x) => {
            return predicate(x) && !(x.modifiers & 4 /* Private */);
        };
        let baseSymbol;
        let basePredicate;
        for (let n = 0, l = type.associated.length; n < l; ++n) {
            baseSymbol = type.associated[n]; //stub symbol
            basePredicate = (x) => {
                return x.kind === baseSymbol.kind;
            };
            baseSymbol = this.find(baseSymbol.name, basePredicate);
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, baseMemberPredicate, typeHistory));
            }
        }
        return members;
    }
    _indexSymbols(root) {
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(this._indexFilter);
    }
    _indexFilter(s) {
        return s.kind !== 128 /* Parameter */ &&
            (s.kind !== 256 /* Variable */ || !s.scope) &&
            !(s.modifiers & 4096 /* Use */) &&
            s.name.length > 0;
    }
}
exports.SymbolStore = SymbolStore;
