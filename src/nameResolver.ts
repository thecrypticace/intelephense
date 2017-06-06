/* 
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 * 
 */

'use strict';

import { PhpSymbol, SymbolKind } from './symbol';

export class NameResolver {

    private _classStack:[string, string][];
    rules:PhpSymbol[];
    namespace = '';

    constructor() {
        this.rules = [];
        this._classStack = [];
     }

     get className(){
         return this._classStack.length ? this._classStack[this._classStack.length - 1][0] : '';
     }

     get classBaseName(){
         return this._classStack.length ? this._classStack[this._classStack.length - 1][1] : '';
     }

     /**
      * 
      * @param classNameTuple className, classBaseName
      */
     pushClassName(classNameTuple:[string, string]){
        this._classStack.push(classNameTuple);
     }

     popClassName(){
         this._classStack.pop();
     }

    resolveRelative(relativeName: string) {
        return this.concatNamespaceName(this.namespace, relativeName);
    }

    resolveNotFullyQualified(notFqn: string, kind?: SymbolKind) {

        if (!notFqn) {
            return '';
        }

        if (notFqn === 'self' || notFqn === 'static' || notFqn === '$this') {
            return this.className;
        }

        if (notFqn === 'parent') {
            return this.classBaseName;
        }

        let pos = notFqn.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqn, kind ? kind : SymbolKind.Class) :
            this._resolveQualified(notFqn, pos);
    }

    concatNamespaceName(prefix: string, suffix: string) {
        if (!suffix || !prefix) {
            return suffix;
        } else {
            return prefix + '\\' + suffix;
        }
    }

    /**
     * 
     * @param text unqualified name
     * @param kind 
     */
    matchImportedSymbol(text: string, kind: SymbolKind) {
        let s: PhpSymbol;
        for (let n = 0, l = this.rules.length; n < l; ++n) {
            s = this.rules[n];
            if (s.name && s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }

    private _resolveQualified(name: string, pos: number) {
        let s = this.matchImportedSymbol(name.slice(0, pos), SymbolKind.Class);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }

    private _resolveUnqualified(name: string, kind: SymbolKind) {
        let s = this.matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }

}