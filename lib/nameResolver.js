/*
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 *
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
class NameResolver {
    constructor() {
        this.namespace = '';
        this.rules = [];
        this._classStack = [];
    }
    get className() {
        return this._classStack.length ? this._classStack[this._classStack.length - 1][0] : '';
    }
    get classBaseName() {
        return this._classStack.length ? this._classStack[this._classStack.length - 1][1] : '';
    }
    /**
     *
     * @param classNameTuple className, classBaseName
     */
    pushClassName(classNameTuple) {
        this._classStack.push(classNameTuple);
    }
    popClassName() {
        this._classStack.pop();
    }
    resolveRelative(relativeName) {
        return this.concatNamespaceName(this.namespace, relativeName);
    }
    resolveNotFullyQualified(notFqn, kind) {
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
            this._resolveUnqualified(notFqn, kind ? kind : 1 /* Class */) :
            this._resolveQualified(notFqn, pos);
    }
    concatNamespaceName(prefix, suffix) {
        if (!suffix || !prefix) {
            return suffix;
        }
        else {
            return prefix + '\\' + suffix;
        }
    }
    /**
     *
     * @param text unqualified name
     * @param kind
     */
    matchImportedSymbol(text, kind) {
        let s;
        for (let n = 0, l = this.rules.length; n < l; ++n) {
            s = this.rules[n];
            if (s.name && s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }
    _resolveQualified(name, pos) {
        let s = this.matchImportedSymbol(name.slice(0, pos), 1 /* Class */);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }
    _resolveUnqualified(name, kind) {
        let s = this.matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }
}
exports.NameResolver = NameResolver;
