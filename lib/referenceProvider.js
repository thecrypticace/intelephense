/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const typeAggregate_1 = require("./typeAggregate");
class ReferenceProvider {
    constructor(documentStore, symbolStore) {
        this.documentStore = documentStore;
        this.symbolStore = symbolStore;
    }
    provideReferenceLocations(uri, position, referenceContext) {
        let locations = [];
        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);
        if (!doc || !table) {
            return locations;
        }
        let symbols;
        let ref = table.referenceAtPosition(position);
        if (ref) {
            //get symbol definition
            //for constructors get the class instead of __construct
            if (ref.kind === 2048 /* Constructor */) {
                ref = { kind: 1 /* Class */, name: ref.name };
            }
            //if class member then make sure base symbol is fetched
            symbols = this.symbolStore.findSymbolsByReference(ref, 3 /* Base */);
        }
        else {
            return locations;
        }
        let references = this.provideReferences(symbols, table, referenceContext.includeDeclaration);
        for (let n = 0; n < references.length; ++n) {
            locations.push(this.symbolStore.identifierLocation(references[n]));
        }
        return locations;
    }
    /**
     *
     * @param symbols must be base symbols where kind is method, class const or prop
     * @param table
     * @param includeDeclaration
     */
    provideReferences(symbols, table, includeDeclaration) {
        let refs = [];
        let s;
        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            Array.prototype.push.apply(refs, this._provideReferences(s, table));
            //@todo handle includeDeclaration
        }
        //unique
        return Array.from(new Set(refs));
    }
    _provideReferences(symbol, table) {
        switch (symbol.kind) {
            case 128 /* Parameter */:
            case 256 /* Variable */:
                return this._variableReferences(symbol, table);
            case 1 /* Class */:
            case 2 /* Interface */:
            case 4 /* Trait */:
            case 64 /* Function */:
            case 8 /* Constant */:
                return this.symbolStore.findReferences(symbol.name);
            case 16 /* Property */:
                return this._propertyReferences(symbol, table);
            case 1024 /* ClassConstant */:
                return this._classConstantReferences(symbol, table);
            case 32 /* Method */:
                return this._methodReferences(symbol, table);
            default:
                return [];
        }
    }
    _methodReferences(symbol, table) {
        if ((symbol.modifiers & 4 /* Private */) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let name = symbol.name.toLowerCase();
            let fn = (x) => {
                return x.kind === 32 /* Method */ && x.name === name && x.scope && x.scope.toLowerCase() === lcScope;
            };
            return table.references(fn);
        }
        else {
            return this.symbolStore.findReferences(symbol.name, this._createMemberReferenceFilterFn(symbol));
        }
    }
    _classConstantReferences(symbol, table) {
        if ((symbol.modifiers & 4 /* Private */) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let fn = (x) => {
                return x.kind === 1024 /* ClassConstant */ && x.name === symbol.name && x.scope && x.scope.toLowerCase() === lcScope;
            };
            return table.references(fn);
        }
        else {
            return this.symbolStore.findReferences(symbol.name, this._createMemberReferenceFilterFn(symbol));
        }
    }
    _propertyReferences(symbol, table) {
        let name = symbol.name;
        if ((symbol.modifiers & 4 /* Private */) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let fn = (x) => {
                return x.kind === 16 /* Property */ && x.name === name && x.scope && lcScope === x.scope.toLowerCase();
            };
            return table.references(fn);
        }
        else {
            return this.symbolStore.findReferences(name, this._createMemberReferenceFilterFn(symbol));
        }
    }
    _createMemberReferenceFilterFn(baseMember) {
        let store = this.symbolStore;
        let lcBaseTypeName = baseMember.scope ? baseMember.scope.toLowerCase() : '';
        let map = {};
        map[lcBaseTypeName] = true;
        let associatedFilterFn = (x) => {
            return lcBaseTypeName === x.name.toLowerCase();
        };
        return (r) => {
            if (!(r.kind & (16 /* Property */ | 32 /* Method */ | 1024 /* ClassConstant */)) || !r.scope) {
                return false;
            }
            let lcScope = r.scope.toLowerCase();
            if (map[lcScope] !== undefined) {
                return map[lcScope];
            }
            let aggregateType = typeAggregate_1.TypeAggregate.create(store, r.scope);
            if (!aggregateType) {
                return map[lcScope] = false;
            }
            return map[lcScope] = aggregateType.associated(associatedFilterFn).length > 0;
        };
    }
    _variableReferences(symbol, table) {
        let parent = table.parent(symbol);
        let refFn = (r) => {
            return (r.kind === 256 /* Variable */ || r.kind === 128 /* Parameter */) && r.name === symbol.name;
        };
        let refs = symbol_1.PhpSymbol.filterReferences(parent, refFn);
        //descend into closures
        let useVarFn = (s) => {
            return s.kind === 256 /* Variable */ &&
                (s.modifiers & 4096 /* Use */) > 0 &&
                s.name === symbol.name;
        };
        let closureFn = (s) => {
            return s.kind === 64 /* Function */ &&
                (s.modifiers & 512 /* Anonymous */) > 0 &&
                symbol_1.PhpSymbol.filterChildren(s, useVarFn).length > 0;
        };
        let q = symbol_1.PhpSymbol.filterChildren(parent, closureFn);
        let s;
        while ((s = q.shift())) {
            //include the use var symbol
            Array.prototype.push.apply(refs, symbol_1.PhpSymbol.filterChildren(s, useVarFn));
            Array.prototype.push.apply(refs, symbol_1.PhpSymbol.filterReferences(s, refFn));
            //descend into closures
            Array.prototype.push.apply(q, symbol_1.PhpSymbol.filterChildren(s, closureFn));
        }
        return refs;
    }
}
exports.ReferenceProvider = ReferenceProvider;
