/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {PhpSymbol, SymbolKind, SymbolModifier} from './symbol';
import {SymbolStore} from './symbolStore';
import {Predicate} from './types';

export const enum MemberMergeStrategy {
    None,
    First,
    Documented,
}

export class TypeAggregate {

    private _symbol: PhpSymbol;
    private _associated: PhpSymbol[];
    private _memberMergeStrategy:MemberMergeStrategy;

    constructor(public symbolStore: SymbolStore, symbol: PhpSymbol, memberMergeStrategy:MemberMergeStrategy) {
        if (!symbol || !(symbol.kind & (SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait))) {
            throw new Error('Invalid Argument');
        }
        this._symbol = symbol;
        this._memberMergeStrategy = memberMergeStrategy;
    }

    get type() {
        return this._symbol;
    }

    associated(fqn: string) {
        return this._getAssociated().find((x) => {
            return x.name === fqn;
        });
    }

    members(predicate?: Predicate<PhpSymbol>) {

        let associated = this._getAssociated().slice(0);
        associated.unshift(this._symbol);

        switch (this._symbol.kind) {
            case SymbolKind.Class:
                return this._classMembers(associated, predicate);
            case SymbolKind.Interface:
                return this._interfaceMembers(associated, predicate);
            case SymbolKind.Trait:
                return this._traitMembers(associated, predicate);
            default:
                return [];
        }

    }

    /**
     * root type should be first element of associated array
     * @param associated 
     * @param predicate 
     */
    private _classMembers(associated: PhpSymbol[], predicate?: Predicate<PhpSymbol>) {

        let members: PhpSymbol[] = [];
        let s: PhpSymbol;
        let traits: PhpSymbol[] = [];
        let noPrivate = (x:PhpSymbol)=> {
            return !(x.modifiers & SymbolModifier.Private) && (!predicate || predicate(x));
        };

        for (let n = 0; n < associated.length; ++n) {
            s = associated[n];
            if (s.kind === SymbolKind.Trait) {
                traits.push(s);
            } else if (s.children) {
                Array.prototype.push.apply(members, predicate ? s.children.filter(predicate): s.children);
            }

            predicate = noPrivate;
        }

        predicate = noPrivate;
        members = this._mergeMembers(members);
        //@todo trait precendence/alias
        Array.prototype.push.apply(members, this._traitMembers(traits, predicate));
        return members;

    }

    private _interfaceMembers(interfaces: PhpSymbol[], predicate?: Predicate<PhpSymbol>) {
        let members: PhpSymbol[] = [];
        let s: PhpSymbol;
        for (let n = 0; n < interfaces.length; ++n) {
            s = interfaces[n];
            if (s.children) {
                Array.prototype.push.apply(members, predicate ? s.children.filter(predicate) : s.children);
            }
        }
        return members;
    }

    private _traitMembers(traits: PhpSymbol[], predicate?: Predicate<PhpSymbol>) {
        //@todo support trait precendence and alias here
        return this._interfaceMembers(traits, predicate);
    }

    private _mergeMembers(symbols: PhpSymbol[]) {

        let map: { [index: string]: number } = {};
        let merged: PhpSymbol[] = [];
        let s: PhpSymbol;
        let index: number;

        if(this._memberMergeStrategy === MemberMergeStrategy.None) {
            return symbols;
        }

        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            index = map[s.name];
            if (index === undefined) {
                merged.push(s);
                map[s.name] = merged.length - 1;
            } else if (this._memberMergeStrategy === MemberMergeStrategy.Documented && !merged[index].doc && s.doc) {
                merged[index] = s;
            }

        }

        return merged;
    }

    private _getAssociated() {

        if (this._associated) {
            return this._associated;
        }

        this._associated = [];
        let symbol = this._symbol;
        if (!symbol.associated || !symbol.associated.length) {
            return this._associated;
        }

        let queue: PhpSymbol[] = [];
        let stub: PhpSymbol;
        Array.prototype.push.apply(queue, symbol.associated);
        let predicate = TypeAggregate._classInterfaceTraitFilter;

        while ((stub = queue.shift())) {

            symbol = this.symbolStore.find(stub.name, predicate).shift();
            if (!symbol || this._associated.indexOf(symbol) > -1) {
                continue;
            }
            this._associated.push(symbol);
            if (symbol.associated) {
                Array.prototype.push.apply(queue, symbol.associated);
            }
        }

        return this._associated;

    }

    private static _classInterfaceTraitFilter(s: PhpSymbol) {
        const mask = SymbolKind.Class | SymbolKind.Interface | SymbolKind.Trait;
        return (s.kind & mask) > 0;
    }

    static create(symbolStore:SymbolStore, fqn:string, memberMergeStrategy:MemberMergeStrategy) {

        if (!fqn) {
            return null;
        }

        let symbol = symbolStore.find(fqn, TypeAggregate._classInterfaceTraitFilter).shift();
        if (!symbol) {
            return null;
        }

        return new TypeAggregate(symbolStore, symbol, memberMergeStrategy);

    
    }

}