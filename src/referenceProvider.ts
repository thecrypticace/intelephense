/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { Position, ReferenceContext, Location } from 'vscode-languageserver-types';
import { ParsedDocumentStore, ParsedDocument } from './parsedDocument';
import { ParseTreeTraverser } from './context';
import { SymbolStore, SymbolTable } from './symbolStore';
import { Reference, PhpSymbol, SymbolKind, SymbolModifier, SymbolIdentifier } from './symbol';
import { MemberMergeStrategy, TypeAggregate } from './typeAggregate';

export class ReferenceProvider {

    constructor(public documentStore: ParsedDocumentStore, public symbolStore: SymbolStore) {

    }

    provideReferenceLocations(uri: string, position: Position, referenceContext: ReferenceContext) {

        let locations: Location[] = [];
        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);

        if (!doc || !table) {
            return locations;
        }

        let traverser = new ParseTreeTraverser(doc, table);
        let token = traverser.position(position);
        let symbols: PhpSymbol[];
        let ref = traverser.reference;

        if (ref) {
            //get symbol definition
            //if class member then make sure base symbol is fetched
            symbols = this.symbolStore.findSymbolsByReference(ref, MemberMergeStrategy.Base);
        } else if (traverser.isDeclarationName) {
            let s = this.symbolStore.findBaseMember(traverser.scope);
            symbols = [s];
        } else {
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
    provideReferences(symbols: PhpSymbol[], table:SymbolTable, includeDeclaration:boolean): SymbolIdentifier[] {

        let refs:SymbolIdentifier[] = [];
        let s:PhpSymbol;

        for(let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            Array.prototype.push.apply(refs, this._provideReferences(s, table));

            if(includeDeclaration) {

                if(
                    (s.kind & (SymbolKind.ClassConstant | SymbolKind.Method | SymbolKind.Property)) > 0 &&
                    !(s.modifiers & SymbolModifier.Private)
                ) {
                    Array.prototype.unshift.apply(refs, this.symbolStore.findOverrides(s));
                }
                refs.unshift(s);

            }

        }

        //unique
        return Array.from(new Set<SymbolIdentifier>(refs));

    }

    private _provideReferences(symbol: PhpSymbol, table: SymbolTable) : Reference[] {

        switch (symbol.kind) {
            case SymbolKind.Parameter:
            case SymbolKind.Variable:
                return this._variableReferences(symbol, table);
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
            case SymbolKind.Function:
            case SymbolKind.Constant:
                return this.symbolStore.findReferences(symbol.name);
            case SymbolKind.Property:
                return this._propertyReferences(symbol, table);
            case SymbolKind.ClassConstant:
                return this._classConstantReferences(symbol, table);
            case SymbolKind.Method:
                return this._methodReferences(symbol, table);
            default:
                return [];
        }

    }

    private _methodReferences(symbol:PhpSymbol, table:SymbolTable) {
        
        if ((symbol.modifiers & SymbolModifier.Private) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let name = symbol.name.toLowerCase();
            let fn = (x: Reference) => {
                return x.kind === SymbolKind.Method && x.name === name && x.scope && x.scope.toLowerCase() === lcScope;
            };
            return table.references(fn);
        } else {
            return this.symbolStore.findReferences(symbol.name, this._createMemberReferenceFilterFn(symbol));
        }
    }

    private _classConstantReferences(symbol:PhpSymbol, table:SymbolTable) {
        
        if ((symbol.modifiers & SymbolModifier.Private) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let fn = (x: Reference) => {
                return x.kind === SymbolKind.ClassConstant && x.name === symbol.name && x.scope && x.scope.toLowerCase() === lcScope;
            };
            return table.references(fn);
        } else {
            return this.symbolStore.findReferences(symbol.name, this._createMemberReferenceFilterFn(symbol));
        }
    }

    private _propertyReferences(symbol: PhpSymbol, table:SymbolTable) {

        let name = (symbol.modifiers & SymbolModifier.Static) > 0 ? symbol.name : symbol.name.slice(1);
        if ((symbol.modifiers & SymbolModifier.Private) > 0) {
            let lcScope = symbol.scope ? symbol.scope.toLowerCase() : '';
            let fn = (x: Reference) => {
                return x.kind === SymbolKind.Property && x.name === name && x.scope && lcScope === x.scope.toLowerCase();
            };
            return table.references(fn);
        } else {
            return this.symbolStore.findReferences(name, this._createMemberReferenceFilterFn(symbol));
        }

    }

    private _createMemberReferenceFilterFn(baseMember: PhpSymbol) {

        let store = this.symbolStore;
        let lcBaseTypeName = baseMember.scope ? baseMember.scope.toLowerCase() : '';
        let map: { [index: string]: boolean } = {};
        map[lcBaseTypeName] = true;
        let associatedFilterFn = (x: PhpSymbol) => {
            return lcBaseTypeName === x.name.toLowerCase();
        };

        return (r: Reference) => {

            if (!(r.kind & (SymbolKind.Property | SymbolKind.Method | SymbolKind.ClassConstant)) || !r.scope) {
                return false;
            }

            let lcScope = r.scope.toLowerCase();
            if (map[lcScope] !== undefined) {
                return map[lcScope];
            }

            let type = store.find(r.scope, PhpSymbol.isClassLike).shift();
            if (!type) {
                return map[lcScope] = false;
            }

            let aggregateType = new TypeAggregate(store, type, MemberMergeStrategy.None);
            return map[lcScope] = aggregateType.associated(associatedFilterFn).length > 0;

        };

    }

    private _variableReferences(symbol: PhpSymbol, table:SymbolTable) {
        let parent = table.parent(symbol);
        let refFn = (r: Reference) => {
            return r.kind === SymbolKind.Variable && r.name === symbol.name;
        };
        let refs: SymbolIdentifier[] = PhpSymbol.filterReferences(parent, refFn);

        //descend into closures
        let useVarFn = (s: PhpSymbol) => {
            return s.kind === SymbolKind.Variable &&
                (s.modifiers & SymbolModifier.Use) > 0 &&
                s.name === symbol.name;
        };

        let closureFn = (s: PhpSymbol) => {
            return s.kind === SymbolKind.Function &&
                (s.modifiers & SymbolModifier.Anonymous) > 0 &&
                PhpSymbol.filterChildren(s, useVarFn).length > 0;
        };

        let q = PhpSymbol.filterChildren(parent, closureFn);
        let s: PhpSymbol;

        while ((s = q.shift())) {

            //include the use var symbol
            Array.prototype.push.apply(refs, PhpSymbol.filterChildren(s, useVarFn));
            Array.prototype.push.apply(refs, PhpSymbol.filterReferences(s, refFn));
            //descend into closures
            Array.prototype.push.apply(q, PhpSymbol.filterChildren(s, closureFn));

        }

        return refs;

    }

}