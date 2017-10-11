/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const symbol_1 = require("./symbol");
const util = require("./util");
class TypeAggregate {
    constructor(symbolStore, symbol, excludeTraits) {
        this.symbolStore = symbolStore;
        this._excludeTraits = false;
        if (!symbol || !(symbol.kind & (1 /* Class */ | 2 /* Interface */ | 4 /* Trait */))) {
            throw new Error('Invalid Argument' + JSON.stringify(symbol, null, 4));
        }
        this._symbol = symbol;
        this._excludeTraits = excludeTraits;
    }
    get type() {
        return this._symbol;
    }
    get name() {
        return this._symbol.name;
    }
    isBaseClass(name) {
        let lcName = name.toLowerCase();
        let fn = (x) => {
            return x.kind === 1 /* Class */ && lcName === x.name.toLowerCase();
        };
        return symbol_1.PhpSymbol.findChild(this._symbol, fn) !== undefined;
    }
    isAssociated(name) {
        if (!name) {
            return false;
        }
        let lcName = name.toLowerCase();
        let fn = (x) => {
            return x.name.toLowerCase() === lcName;
        };
        return this.associated(fn).length > 0;
    }
    associated(filter) {
        let assoc = this._getAssociated();
        return filter ? util.filter(assoc, filter) : assoc;
    }
    members(mergeStrategy, predicate) {
        let associated = this._getAssociated().slice(0);
        associated.unshift(this._symbol);
        switch (this._symbol.kind) {
            case 1 /* Class */:
                return this._classMembers(associated, mergeStrategy, predicate);
            case 2 /* Interface */:
                return this._interfaceMembers(associated, predicate);
            case 4 /* Trait */:
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
    _classMembers(associated, strategy, predicate) {
        let members = [];
        let s;
        let traits = [];
        let p = predicate;
        let noPrivate = (x) => {
            return !(x.modifiers & 4 /* Private */) && (!predicate || predicate(x));
        };
        for (let n = 0; n < associated.length; ++n) {
            s = associated[n];
            if (s.kind === 4 /* Trait */) {
                traits.push(s);
            }
            else if (s.children) {
                Array.prototype.push.apply(members, p ? s.children.filter(p) : s.children);
            }
            p = noPrivate;
        }
        p = noPrivate;
        members = this._mergeMembers(members, strategy);
        //@todo trait precendence/alias
        Array.prototype.push.apply(members, this._traitMembers(traits, p));
        return members;
    }
    _interfaceMembers(interfaces, predicate) {
        let members = [];
        let s;
        for (let n = 0; n < interfaces.length; ++n) {
            s = interfaces[n];
            if (s.children) {
                Array.prototype.push.apply(members, predicate ? s.children.filter(predicate) : s.children);
            }
        }
        return members;
    }
    _traitMembers(traits, predicate) {
        //@todo support trait precendence and alias here
        return this._interfaceMembers(traits, predicate);
    }
    _mergeMembers(symbols, strategy) {
        let map = {};
        let s;
        let mapped;
        if (strategy === 0 /* None */) {
            return symbols;
        }
        for (let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            mapped = map[s.name];
            if (!mapped ||
                ((mapped.modifiers & 256 /* Magic */) > 0 && !(s.modifiers & 256 /* Magic */)) || //always prefer non magic
                (strategy === 2 /* Documented */ && (!mapped.doc || this.hasInheritdoc(mapped.doc.description)) && s.doc) ||
                (strategy === 3 /* Base */)) {
                map[s.name] = s;
            }
        }
        return Object.keys(map).map((v) => { return map[v]; });
    }
    hasInheritdoc(description) {
        if (!description) {
            return false;
        }
        description = description.toLowerCase().trim();
        return description === '@inheritdoc' || description === '{@inheritdoc}';
    }
    _getAssociated() {
        if (this._associated) {
            return this._associated;
        }
        this._associated = [];
        let symbol = this._symbol;
        if (!symbol.associated || !symbol.associated.length) {
            return this._associated;
        }
        let queue = [];
        let stub;
        Array.prototype.push.apply(queue, symbol.associated);
        while ((stub = queue.shift())) {
            if (this._excludeTraits && stub.kind === 4 /* Trait */) {
                continue;
            }
            symbol = this.symbolStore.find(stub.name, symbol_1.PhpSymbol.isClassLike).shift();
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
    static create(symbolStore, fqn) {
        if (!fqn) {
            return null;
        }
        let symbol = symbolStore.find(fqn, symbol_1.PhpSymbol.isClassLike).shift();
        if (!symbol) {
            return null;
        }
        return new TypeAggregate(symbolStore, symbol);
    }
}
exports.TypeAggregate = TypeAggregate;
