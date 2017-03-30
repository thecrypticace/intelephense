/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Location } from 'vscode-languageserver-types';
import {
    Predicate, TreeTraverser, TreeVisitor, BinarySearch, ToArrayVisitor,
    CountVisitor
} from './types';
import {
    Phrase, PhraseType, Token, TokenType, NamespaceName, FunctionDeclarationHeader,
    ReturnType, TypeDeclaration, QualifiedName, ParameterDeclarationList,
    ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration,
    ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList,
    InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause,
    TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElementList,
    ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader,
    PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition,
    NamespaceUseDeclaration, NamespaceUseClause, NamespaceAliasingClause, AnonymousClassDeclaration,
    AnonymousClassDeclarationHeader, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable,
    TraitUseClause, SimpleVariable, ObjectCreationExpression
} from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { ParseTree } from './parse';
import { TextDocument } from './document';
import * as util from './util';

export const enum SymbolKind {
    None = 0,
    Class = 1 << 0,
    Interface = 1 << 1,
    Trait = 1 << 2,
    Constant = 1 << 3,
    Property = 1 << 4,
    Method = 1 << 5,
    Function = 1 << 6,
    Parameter = 1 << 7,
    Variable = 1 << 8,
    Namespace = 1 << 9
}

export const enum SymbolModifier {
    None = 0,
    Public = 1 << 0,
    Protected = 1 << 1,
    Private = 1 << 2,
    Final = 1 << 3,
    Abstract = 1 << 4,
    Static = 1 << 5,
    ReadOnly = 1 << 6,
    WriteOnly = 1 << 7,
    Magic = 1 << 8,
    Anonymous = 1 << 9,
    Reference = 1 << 10,
    Variadic = 1 << 11,
    Use = 1 << 12
}

export interface PhpSymbol {
    kind: SymbolKind;
    name: string;
    location?: Location;
    modifiers?: SymbolModifier;
    description?: string;
    type?: TypeString;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    scope?: string;
}

export namespace PhpSymbol {

    export function acronym(s: PhpSymbol) {

        let text = s.name.slice(s.name.lastIndexOf('\\') + 1);

        if (!text) {
            return '';
        }

        let lcText = text.toLowerCase();
        let n = 0;
        let l = text.length;
        let c: string;
        let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';

        while (n < l) {

            c = text[n];

            if ((c === '$' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                acronym += lcText[n];
            } else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                acronym += lcText[n];
            }

            ++n;

        }

        return acronym;
    }

    /**
     * Get suffixes after $, namespace separator, underscore and on lowercase uppercase boundary
     */
    export function suffixArray(s: PhpSymbol) {
        if (!s.name) {
            return [];
        }

        let text = s.name;
        let lcText = text.toLowerCase();
        let suffixes = [lcText];
        let n = 0;
        let c: string;
        let l = text.length;

        while (n < l) {

            c = text[n];

            if ((c === '$' || c === '\\' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                suffixes.push(lcText.slice(n));
            } else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                suffixes.push(lcText.slice(n));
            }

            ++n;

        }

        return suffixes;
    }

}

export class NameResolver {

    constructor(
        public namespaceName: string,
        public thisName: string,
        public importedSymbols: PhpSymbol[]
    ) { }

    resolveRelative(relativeName: string) {
        if (!relativeName) {
            return '';
        }
        return this.namespaceName ? this.namespaceName + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {

        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }

        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(name, pos);
    }

    private _matchImportedSymbol(text: string, kind: SymbolKind) {
        let s: PhpSymbol;
        for (let n = 0, l = this.importedSymbols.length; n < l; ++n) {
            s = this.importedSymbols[n];
            if (s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }

    private _resolveQualified(name: string, pos: number) {
        let s = this._matchImportedSymbol(name.slice(0, pos), SymbolKind.Class);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }

    private _resolveUnqualified(name: string, kind: SymbolKind) {
        let s = this._matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }

}

export class TypeString {

    private static _classNamePattern: RegExp = /([\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff])*/g;

    private static _keywords: string[] = [
        'string', 'integer', 'int', 'boolean', 'bool', 'float',
        'double', 'object', 'mixed', 'array', 'resource',
        'void', 'null', 'callback', 'false', 'true', 'self',
        'callable'
    ];

    private _parts: string[];

    constructor(text: string) {
        this._parts = text ? this._chunk(text) : [];
    }

    isEmpty() {
        return this._parts.length < 1;
    }

    atomicClassArray() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }

        return parts;

    }

    arrayDereference() {

        let parts: string[] = [];
        let part: string;

        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];

            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                } else {
                    parts.push(part);
                }

            }

        }

        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;

    }

    array() {
        let text: string;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        } else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }

    merge(type: string | TypeString) {

        let parts = util.isString(type) ? this._chunk(<string>type) : (<TypeString>type)._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }

    nameResolve(nameResolver: NameResolver) {

        let replacer = (match, offset, text) => {

            if (TypeString._keywords.indexOf(match[0]) >= 0) {
                return match[0];
            } else if (match[0] === '\\') {
                return match.slice(1);
            } else {
                return nameResolver.resolveNotFullyQualified(match, SymbolKind.Class);
            }

        };

        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }

    toString() {
        return this._parts.join('|');
    }

    private _unique(parts: string[]) {
        let map: { [index: string]: string } = {};
        let part: string;

        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }

        return Object.keys(map);
    }

    private _chunk(typeString: string) {

        let n = 0;
        let parentheses = 0;
        let parts: string[] = [];
        let part: string = '';
        let c: string;

        while (n < typeString.length) {

            c = typeString[n];

            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    } else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }

            ++n;
        }

        if (part) {
            parts.push(part);
        }

        return parts;

    }


}

/*
export class SymbolTree {

    static parametersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Parameter;
    };

    static closureUseVariablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable &&
            (x.value.modifiers & SymbolModifier.Use) > 0;
    };

    static variablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable;
    };

    static instanceExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static staticInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static parameters(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.parametersPredicate);
    }

    static closureUseVariables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.closureUseVariablesPredicate);
    }

    static variables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.variablesPredicate);
    }

}
*/

export class SymbolTable {

    constructor(
        public uri: string,
        public root: PhpSymbol
    ) { }

    get symbols() {
        let traverser = new TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }

    get count() {
        let traverser = new TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }

    filter(predicate: Predicate<PhpSymbol>) {
        let traverser = new TreeTraverser([this.root]);
        return traverser.filter(predicate)
    }

    static create(parseTree: ParseTree, textDocument: TextDocument) {

        let symbolReader = new SymbolReader(
            textDocument,
            new NameResolver(null, null, []),
            [{ kind: SymbolKind.None, name: '', children: [] }]
        );

        let traverser = new TreeTraverser<Phrase | Token>([parseTree.root]);
        traverser.traverse(symbolReader);
        return new SymbolTable(
            textDocument.uri,
            symbolReader.spine[0]
        );

    }

}


export class SymbolStore {

    private _map: { [index: string]: SymbolTable };
    private _index: SymbolIndex;
    private _symbolCount: number;

    constructor() {
        this._map = {};
        this._index = new SymbolIndex();
        this._symbolCount = 0;
    }

    getSymbolTable(uri: string) {
        return this._map[uri];
    }

    get tableCount() {
        return Object.keys(this._map).length;
    }

    get symbolCount() {
        return this._symbolCount;
    }

    add(symbolTable: SymbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }

    remove(uri: string) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }

    /**
     * Matches any symbol by name or partial name (excluding parameters and variables) 
     */
    match(text: string, kindMask?: SymbolKind) {
        let matched = this._index.match(text);

        if (!kindMask) {
            return matched;
        }

        let filtered: PhpSymbol[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if ((s.kind & kindMask) > 0) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    lookupTypeMembers(typeName: string, memberPredicate: Predicate<PhpSymbol>) {
        let type = this.match(typeName, SymbolKind.Class | SymbolKind.Interface).shift();
        return this._lookupTypeMembers(type, memberPredicate);
    }

    lookupTypeMember(typeName: string, memberPredicate: Predicate<PhpSymbol>) {
        return this.lookupTypeMembers(typeName, memberPredicate).shift();
    }

    private _lookupTypeMembers(type: PhpSymbol, predicate: Predicate<PhpSymbol>) {

        if (!type) {
            return [];
        }

        let members = type.children.filter(predicate);
        let associated: PhpSymbol[] = [];
        let associatedKindMask = SymbolKind.Class ? SymbolKind.Class | SymbolKind.Trait : SymbolKind.Interface;
        let baseSymbol: PhpSymbol;

        if (type.associated) {
            for (let n = 0, l = type.associated.length; n < l; ++n) {
                baseSymbol = type.associated[n];
                if ((baseSymbol.kind & associatedKindMask) > 0 && baseSymbol.name) {
                    associated.push(baseSymbol);
                }
            }
        }

        //lookup in base class/traits
        let basePredicate: Predicate<PhpSymbol> = (x) => {
            return predicate(x) && !(x.modifiers & SymbolModifier.Private);
        };

        for (let n = 0, l = associated.length; n < l; ++n) {
            baseSymbol = associated[n];
            baseSymbol = this.match(baseSymbol.name, baseSymbol.kind).shift();
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, basePredicate));
            }

        }

        return members;
    }

    private _indexSymbols(root: PhpSymbol) {

        let notKindMask = SymbolKind.Parameter | SymbolKind.Variable;

        let predicate: Predicate<PhpSymbol> = (x) => {
            return !(x.kind & notKindMask) && !!x.name;
        };

        let traverser = new TreeTraverser([root]);
        return traverser.filter(predicate);

    }



}

/*

interface ResolvedVariable {
    name: string;
    type: TypeString;
}

const enum VariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface VariableSet {
    kind: VariableSetKind;
    vars: { [index: string]: ResolvedVariable };
}


export class VariableTable {

    private _node: Tree<VariableSet>;
    private _thisTypeStack: TypeString[];

    constructor() {
        this._node = new Tree<VariableSet>({
            kind: VariableSetKind.Scope,
            vars: {}
        });
        this._thisTypeStack = [];
    }

    setType(varName: string, type: TypeString) {
        this._node.value.vars[varName] = { name: varName, type: type };
    }

    pushThisType(thisType: TypeString) {
        this._thisTypeStack.push(thisType);
    }

    popThisType() {
        this._thisTypeStack.pop();
    }

    pushScope(carry: string[] = null) {

        let resolvedVariables: ResolvedVariable[] = [];
        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    resolvedVariables.push({ name: carry[n], type: type });
                }
            }
        }

        this._pushNode(VariableSetKind.Scope);
        for (let n = 0; n < resolvedVariables.length; ++n) {
            this.setType(resolvedVariables[n].name, resolvedVariables[n].type);
        }
    }

    popScope() {
        this._node = this._node.parent;
    }

    pushBranch() {
        this._pushNode(VariableSetKind.Branch);
    }

    popBranch() {
        this._node = this._node.parent;
    }

    pushBranchGroup() {
        this._pushNode(VariableSetKind.BranchGroup);
    }

    popBranchGroup() {

        //can consolidate variables and prune tree as at this point
        //each variable may be any of types discovered in branches 
        let b = this._node;
        this._node = b.parent;
        let consolidator = new TypeConsolidator(this._node.value.vars);
        b.traverse(consolidator);
        this._node.removeChild(b);

    }

    getType(varName: string) {

        let type: TypeString;
        let vars: { [index: string]: ResolvedVariable };
        let node = this._node;

        if (varName === '$this') {
            return util.top<TypeString>(this._thisTypeStack);
        }

        while (node) {

            if (node.value.vars.hasOwnProperty(varName)) {
                return node.value.vars[varName].type;
            } else if (node.value.kind !== VariableSetKind.Scope) {
                node = node.parent;
            } else {
                break;
            }

        }

        return null;

    }

    private _pushNode(kind: VariableSetKind) {
        let node = new Tree<VariableSet>({
            kind: kind,
            vars: {}
        });
        this._node = this._node.addChild(node);
    }

}

class TypeConsolidator implements TreeVisitor<VariableSet> {

    constructor(public variables: { [index: string]: ResolvedVariable }) {

    }

    preOrder(node: Tree<VariableSet>) {

        let keys = Object.keys(node.value.vars);
        let v: ResolvedVariable;
        let key: string;

        for (let n = 0; n < keys.length; ++n) {
            key = keys[n];
            v = node.value.vars[key];

            if (this.variables.hasOwnProperty(key)) {
                this.variables[key].type = this.variables[key].type.merge(v.type);
            } else {
                this.variables[key] = v;
            }
        }

        return true;

    }

}

*/

export class SymbolReader implements TreeVisitor<Phrase | Token> {

    lastPhpDoc: PhpDoc;
    lastPhpDocLocation: Location;
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string;
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;

    constructor(
        public textDocument: TextDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) {
        SymbolReader.textDocument = textDocument;
        SymbolReader.nameResolver = nameResolver;
    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let s: PhpSymbol;

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                s = SymbolReader.namespaceDefinition(<NamespaceDefinition>node);
                this.nameResolver.namespaceName = s.name;
                this._addSymbol(s, false);
                return true;

            case PhraseType.NamespaceUseDeclaration:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    SymbolReader.namespaceUseDeclaration(<NamespaceUseDeclaration>node);
                return true;

            case PhraseType.NamespaceUseClause:
                s = SymbolReader.namespaceUseClause(<NamespaceUseClause>node,
                    this.namespaceUseDeclarationKind,
                    this.namespaceUseDeclarationPrefix
                );
                this._addSymbol(s, false);
                if (s.associated && s.associated.length > 0 && s.name) {
                    this.nameResolver.importedSymbols.push(s);
                }
                return false;

            case PhraseType.ConstElement:
                this._addSymbol(SymbolReader.constElement(<ConstElement>node, this.lastPhpDoc), false);
                return false;

            case PhraseType.FunctionDeclaration:
                this._addSymbol(
                    SymbolReader.functionDeclaration(<FunctionDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.FunctionDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.functionDeclarationHeader(<FunctionDeclarationHeader>node);
                return true;

            case PhraseType.ParameterDeclaration:
                this._addSymbol(
                    SymbolReader.parameterDeclaration(<ParameterDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.TypeDeclaration:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = SymbolReader.typeDeclaration(<TypeDeclaration>node);
                s.type = s.type ? s.type.merge(typeDeclarationValue) : new TypeString(typeDeclarationValue);
                return false;

            case PhraseType.ClassDeclaration:
                this._addSymbol(
                    SymbolReader.classDeclaration(<ClassDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.ClassDeclarationHeader:
                SymbolReader.classDeclarationHeader(
                    this.spine[this.spine.length - 1],
                    <ClassDeclarationHeader>node
                );
                return true;

            case PhraseType.ClassBaseClause:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = SymbolReader.classBaseClause(<ClassBaseClause>node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                } else {
                    s.associated = [classBaseClause];
                }
                return false;

            case PhraseType.ClassInterfaceClause:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = SymbolReader.classInterfaceClause(<ClassInterfaceClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                } else {
                    s.associated = classInterfaceClause;
                }
                return false;

            case PhraseType.InterfaceDeclaration:
                this._addSymbol(
                    SymbolReader.interfaceDeclaration(<InterfaceDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.InterfaceDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.interfaceDeclarationHeader(<InterfaceDeclarationHeader>node);
                return false;

            case PhraseType.InterfaceBaseClause:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = SymbolReader.interfaceBaseClause(<InterfaceBaseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                } else {
                    s.associated = interfaceBaseClause;
                }
                return false;

            case PhraseType.TraitDeclaration:
                this._addSymbol(
                    SymbolReader.traitDeclaration(<TraitDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.TraitDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.traitDeclarationHeader(<TraitDeclarationHeader>node);
                return false;

            case PhraseType.ClassConstDeclaration:
                this.classConstDeclarationModifier =
                    SymbolReader.classConstantDeclaration(<ClassConstDeclaration>node);
                return true;

            case PhraseType.ClassConstElement:
                this._addSymbol(
                    SymbolReader.classConstElement(
                        this.classConstDeclarationModifier,
                        <ClassConstElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.PropertyDeclaration:
                this.propertyDeclarationModifier =
                    SymbolReader.propertyDeclaration(<PropertyDeclaration>node);
                return true;

            case PhraseType.PropertyElement:
                this._addSymbol(
                    SymbolReader.propertyElement(
                        this.propertyDeclarationModifier,
                        <PropertyElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.TraitUseClause:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = SymbolReader.traitUseClause(<TraitUseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                } else {
                    s.associated = traitUseClause;
                }
                return false;

            case PhraseType.MethodDeclaration:
                this._addSymbol(
                    SymbolReader.methodDeclaration(<MethodDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.MethodDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    SymbolReader.methodDeclarationHeader(<MethodDeclarationHeader>node);
                return true;

            case PhraseType.MemberModifierList:
                this.spine[this.spine.length - 1].modifiers =
                    SymbolReader.memberModifierList(<MemberModifierList>node);
                return false;

            case PhraseType.AnonymousClassDeclaration:
                this._addSymbol(
                    SymbolReader.anonymousClassDeclaration(<AnonymousClassDeclaration>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionCreationExpression:
                this._addSymbol(
                    SymbolReader.anonymousFunctionCreationExpression(<AnonymousFunctionCreationExpression>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionUseVariable:
                this._addSymbol(
                    SymbolReader.anonymousFunctionUseVariable(<AnonymousFunctionUseVariable>node),
                    false
                );
                return false;

            case PhraseType.SimpleVariable:
                s = SymbolReader.simpleVariable(<SimpleVariable>node);
                if (s && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;

            case undefined:
                this._token(<Token>node);
                return false;

            default:
                return true;
        }

    }

    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this.nameResolver.namespaceName = '';
                }
                break;
            case PhraseType.FunctionDeclaration:
            case PhraseType.ParameterDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this.spine.pop();
                break;
            default:
                break;
        }

    }

    private _variableExists(name: string) {
        let parent = this.spine[this.spine.length - 1];

        if (!parent.children) {
            return false;
        }

        let mask = SymbolKind.Parameter | SymbolKind.Variable;
        let s:PhpSymbol;

        for (let n = 0, l = parent.children.length; n < l; ++n) {
            s = parent.children[n];
            if ((s.kind & mask) > 0 && s.name === name) {
                return true;
            }
        }

        return false;
    }

    private _token(t: Token) {

        switch (t.tokenType) {
            case TokenType.DocumentComment:
                let phpDocTokenText = ParseTree.tokenText(t, this.textDocument);
                this.lastPhpDoc = PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = {
                    uri: this.textDocument.uri,
                    range: {
                        start: this.textDocument.positionAtOffset(t.offset),
                        end: this.textDocument.positionAtOffset(t.offset + phpDocTokenText.length)
                    }
                };
                break;
            case TokenType.CloseBrace:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }

    private _addSymbol(symbol: PhpSymbol, pushToSpine: boolean) {

        if (!symbol) {
            return;
        }

        let parent = this.spine[this.spine.length - 1];

        if (!parent.children) {
            parent.children = [];
        }

        if (parent.name) {
            symbol.scope = parent.name;
        }

        parent.children.push(symbol);

        if (pushToSpine) {
            this.spine.push(symbol);
        }

    }

}


export namespace SymbolReader {

    export var nameResolver: NameResolver;
    export var textDocument: TextDocument;

    export function nameTokenToFqn(t: Token) {
        let name = ParseTree.tokenText(t, textDocument);
        return name ? nameResolver.resolveRelative(name) : '';
    }

    export function phraseLocation(p: Phrase) {
        if (!p) {
            return null;
        }

        let startToken: Token, endToken: Token;
        [startToken, endToken] = ParseTree.tokenRange(p);

        if (!startToken || !endToken) {
            return null;
        }

        return <Location>{
            uri: textDocument.uri,
            range: {
                start: textDocument.positionAtOffset(startToken.offset),
                end: textDocument.positionAtOffset(endToken.offset + endToken.length)
            }
        }
    }

    /**
     * 
     * Uses phrase range to provide "unique" name
     */
    export function anonymousName(node: Phrase) {
        let range = phraseLocation(node).range;
        let suffix = [range.start.line, range.start.character, range.end.line, range.end.character].join('#');
        return '#anonymous#' + suffix;
    }

    export function functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: '',
            location: phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(nameResolver);
            }
        }

        return s;

    }

    export function functionDeclarationHeader(node: FunctionDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Parameter,
            name: ParseTree.tokenText(node.name, textDocument),
            location: phraseLocation(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = new TypeString(tag.typeString).nameResolve(nameResolver);
                s.type = s.type ? s.type.merge(type) : type;
            }
        }

        return s;
    }

    export function typeDeclaration(node: TypeDeclaration) {

        return (<Phrase>node.name).phraseType ?
            qualifiedName(<QualifiedName>node.name, SymbolKind.Class) :
            ParseTree.tokenText(<Token>node.name, textDocument);

    }

    export function qualifiedName(node: QualifiedName, kind: SymbolKind) {
        if (!node || !node.name) {
            return '';
        }

        let name = namespaceName(node.name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return nameResolver.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return nameResolver.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
            default:
                return name;
        }
    }

    export function constElement(node: ConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            name: nameTokenToFqn(node.name),
            location: phraseLocation(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(nameResolver);
            }
        }

        return s;

    }

    export function classConstantDeclaration(node: ClassConstDeclaration) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    export function classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            modifiers: modifiers,
            name: identifier(node.name),
            location: phraseLocation(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(nameResolver);
            }
        }

        return s;

    }

    export function methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            name: '',
            location: phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(nameResolver);
            }
        }

        return s;

    }

    export function memberModifierList(node: MemberModifierList) {
        return modifierListElementsToSymbolModifier(node.elements);
    }

    export function methodDeclarationHeader(node: MethodDeclarationHeader) {
        return identifier(node.name);
    }

    export function propertyDeclaration(node: PropertyDeclaration) {
        return node.modifierList ?
            modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    export function propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Property,
            name: ParseTree.tokenText(node.name, textDocument),
            modifiers: modifiers,
            location: phraseLocation(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(nameResolver);
            }
        }

        return s;

    }

    export function identifier(node: Identifier) {
        return ParseTree.tokenText(node.name, textDocument);
    }

    export function interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc, phpDocLoc:Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Interface,
            name: '',
            location: phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    export function phpDocMembers(phpDoc: PhpDoc, phpDocLoc:Location) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n], phpDocLoc));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n], phpDocLoc));
        }

        return symbols;
    }

    export function methodTagToSymbol(tag: Tag, phpDocLoc:Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            modifiers: SymbolModifier.Magic,
            name: tag.name,
            type: new TypeString(tag.typeString).nameResolve(nameResolver),
            description: tag.description,
            children: [],
            location:phpDocLoc
        };

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }

        return s;
    }

    export function magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc:Location) {

        return <PhpSymbol>{
            kind: SymbolKind.Parameter,
            name: p.name,
            modifiers: SymbolModifier.Magic,
            type: new TypeString(p.typeString).nameResolve(nameResolver),
            location:phpDocLoc
        }

    }

    export function propertyTagToSymbol(t: Tag, phpDocLoc:Location) {
        return <PhpSymbol>{
            kind: SymbolKind.Property,
            name: t.name,
            modifiers: magicPropertyModifier(t) | SymbolModifier.Magic,
            type: new TypeString(t.typeString).nameResolve(nameResolver),
            description: t.description,
            location:phpDocLoc
        };
    }

    export function magicPropertyModifier(t: Tag) {
        switch (t.tagName) {
            case '@property-read':
                return SymbolModifier.ReadOnly;
            case '@property-write':
                return SymbolModifier.WriteOnly;
            default:
                return SymbolModifier.None;
        }
    }

    export function interfaceDeclarationHeader(node: InterfaceDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function interfaceBaseClause(node: InterfaceBaseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            };
        }
        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    export function traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc, phpDocLoc:Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Trait,
            name: '',
            location: phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;
    }

    export function traitDeclarationHeader(node: TraitDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc, phpDocLoc:Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Class,
            name: '',
            location: phraseLocation(node),
            children: []
        };

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    export function classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader) {

        if (node.modifier) {
            s.modifiers = modifierTokenToSymbolModifier(node.modifier);
        }

        s.name = nameTokenToFqn(node.name);
        return s;

    }

    export function classBaseClause(node: ClassBaseClause) {
        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: qualifiedName(node.name, SymbolKind.Class)
        };
    }

    export function classInterfaceClause(node: ClassInterfaceClause) {

        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            }
        }

        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);

    }

    export function traitUseClause(node: TraitUseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Trait,
                name: name
            };
        };

        return qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    export function anonymousClassDeclaration(node: AnonymousClassDeclaration) {

        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: anonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: phraseLocation(node)
        };
    }

    export function anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression) {

        return <PhpSymbol>{
            kind: SymbolKind.Function,
            name: anonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: phraseLocation(node)
        };

    }

    export function anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable) {
        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: ParseTree.tokenText(node.name, textDocument),
            location: phraseLocation(node)
        };
    }

    export function simpleVariable(node: SimpleVariable) {
        if (!node.name || (<Token>node.name).tokenType !== TokenType.VariableName) {
            return null;
        }

        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: ParseTree.tokenText(<Token>node.name, textDocument),
            location: phraseLocation(node)
        };
    }

    export function qualifiedNameList(node: QualifiedNameList) {

        let names: string[] = [];
        let name: string;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = qualifiedName(node.elements[n], SymbolKind.Class);
            if (name) {
                names.push(name);
            }
        }
        return names;

    }

    export function modifierListElementsToSymbolModifier(tokens: Token[]) {

        let flag = SymbolModifier.None;
        if (!tokens || tokens.length < 1) {
            return flag
        }

        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= modifierTokenToSymbolModifier(tokens[n]);
        }

        return flag;
    }

    export function modifierTokenToSymbolModifier(t: Token) {

        switch (t.tokenType) {
            case TokenType.Public:
                return SymbolModifier.Public;
            case TokenType.Protected:
                return SymbolModifier.Protected;
            case TokenType.Private:
                return SymbolModifier.Private;
            case TokenType.Abstract:
                return SymbolModifier.Abstract;
            case TokenType.Final:
                return SymbolModifier.Final;
            case TokenType.Static:
                return SymbolModifier.Static;
            default:
                return SymbolModifier.None;
        }

    }

    export function namespaceName(node: NamespaceName) {

        if (!node || !node.parts || node.parts.length < 1) {
            return null;
        }

        let parts: string[] = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(ParseTree.tokenText(node.parts[n], textDocument));
        }

        return parts.join('\\');

    }

    export function concatNamespaceName(prefix: string, name: string) {
        if (!name) {
            return null;
        } else if (!prefix) {
            return name;
        } else {
            return prefix + '\\' + name;
        }
    }

    export function namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let s: PhpSymbol = {
            kind: kind ? kind : SymbolKind.Class,
            name: node.aliasingClause ? ParseTree.tokenText(node.aliasingClause.alias, textDocument) : null,
            associated: [],
            location: phraseLocation(node)
        };

        let fqn = concatNamespaceName(prefix, namespaceName(node.name));
        if (!fqn) {
            return s;
        }

        s.associated.push({ kind: s.kind, name: fqn });
        if (!node.aliasingClause) {
            s.name = fqn.split('\\').pop();
        }

        return s;

    }

    export function tokenToSymbolKind(t: Token) {
        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    export function namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string] {

        return [
            node.kind ? tokenToSymbolKind(node.kind) : SymbolKind.None,
            node.prefix ? namespaceName(node.prefix) : null
        ];

    }

    export function namespaceDefinition(node: NamespaceDefinition) {

        return <PhpSymbol>{
            kind: SymbolKind.Namespace,
            name: namespaceName(node.name),
            location: phraseLocation(node),
            children: []
        };

    }

}

export class SymbolIndex {

    private _nodeArray: SymbolIndexNode[];
    private _binarySearch: BinarySearch<SymbolIndexNode>;
    private _collator: Intl.Collator;

    constructor() {
        this._nodeArray = [];
        this._binarySearch = new BinarySearch<SymbolIndexNode>(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }

    add(item: PhpSymbol) {

        let suffixes = this._symbolSuffixes(item);
        let node: SymbolIndexNode;

        for (let n = 0; n < suffixes.length; ++n) {

            node = this._nodeFind(suffixes[n]);

            if (node) {
                node.items.push(item);
            } else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }

    }

    addMany(items: PhpSymbol[]) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }

    remove(item: PhpSymbol) {

        let suffixes = this._symbolSuffixes(item);
        let node: SymbolIndexNode;
        let i: number;

        for (let n = 0; n < suffixes.length; ++n) {

            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }

            i = node.items.indexOf(item);

            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    this._deleteNode(node);
                }
            }

        }

    }

    removeMany(items: PhpSymbol[]) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }

    match(text: string) {

        let nodes = this._nodeMatch(text);
        let matches: PhpSymbol[] = [];

        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }

        return Array.from(new Set<PhpSymbol>(matches));

    }

    private _nodeMatch(text: string) {

        let collator = this._collator;
        let lcText = text.toLowerCase();
        let compareLowerFn = (n: SymbolIndexNode) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n: SymbolIndexNode) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        }

        return this._binarySearch.range(compareLowerFn, compareUpperFn);

    }

    private _nodeFind(text: string) {

        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n: SymbolIndexNode) => {
            return collator.compare(n.key, lcText);
        }

        return this._binarySearch.find(compareFn);

    }

    private _insertNode(node: SymbolIndexNode) {

        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });

        this._nodeArray.splice(rank, 0, node);

    }

    private _deleteNode(node: SymbolIndexNode) {

        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });

        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }

    }

    private _symbolSuffixes(s: PhpSymbol) {
        let suffixes = PhpSymbol.suffixArray(s);
        let acronym = PhpSymbol.acronym(s);
        if (acronym.length > 1) {
            suffixes.push(acronym);
        }
        return suffixes;
    }

}

interface SymbolIndexNode {
    key: string;
    items: PhpSymbol[];
}

export interface LookupVariableTypeDelegate {
    (name: string): TypeString;
}

export class ExpressionResolver implements TreeVisitor<Phrase | Token>{

    private _skipStack: Phrase[];
    private _type: TypeString;
    private _lookupVariableTypeDelegate: LookupVariableTypeDelegate;

    constructor(public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        lookupVariableTypeDelegate: LookupVariableTypeDelegate) {
        this._skipStack = [];
        this._lookupVariableTypeDelegate = lookupVariableTypeDelegate;
    }

    get type() {
        return this._type;
    }

    clear() {
        this._type = null;
        this._skipStack = [];
    }

    preOrder(node: Phrase | Token, spine:(Phrase|Token)[]) {

        if (!node.value || util.top<Tree<Phrase | Token>>(this._skipStack) === node) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Variable:
                return false;
            case PhraseType.Dimension:
                //skip dimension offset
                this._skipStack.push(node.children[1]);
                return true;
            case PhraseType.StaticProperty:
            case PhraseType.Property:
                //skip property name
                this._skipStack.push(node.children[1]);
                return true;
            case PhraseType.StaticMethodCall:
            case PhraseType.MethodCall:
                //skip method name and args
                this._skipStack.push(node.children[1], node.children[2]);
                return true;
            case PhraseType.Call:
            case PhraseType.Name:
                return false;
            case PhraseType.BinaryExpression:
                if ((<Phrase>node.value).flag === PhraseFlag.BinaryAssign) {
                    //skip lhs
                    this._skipStack.push(node.children[0]);
                }
                return true;
            case PhraseType.TernaryExpression:
                if (!node.children[1].value) {
                    this._skipStack.push(node.children[1]);
                } else {
                    this._skipStack.push(node.children[0]);
                }

            default:
                return true;
        }

    }

    postOrder(node: Phrase | Token, spine:(Phrase|Token)[]) {


        switch((<Phrase>node).phraseType){

            case PhraseType.SimpleVariable:


        }


        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Variable:
                return this._variable(node);
            case PhraseType.Dimension:
                return this._dimension(node);
            case PhraseType.StaticProperty:
            case PhraseType.Property:
                return this._property(node);
            case PhraseType.StaticMethodCall:
            case PhraseType.MethodCall:
                return this._methodCall(node);
            case PhraseType.Call:
                return this._call(node);
            case PhraseType.Name:
                return this._name(node);
            default:
                break;
        }

    }

    private _dimension(node: Tree<Phrase | Token>) {

        if (this._type) {
            this._type = this._type.arrayDereference();
        }

    }

    private _call(node: Tree<Phrase | Token>) {

        let nameNode = node.children[0];
        let name: string

        if (!nameNode.value || (<Phrase>nameNode.value).phraseType !== PhraseType.Name ||
            !(name = nameNodeToFqnString(nameNode, this.nameResolver, SymbolKind.Function))) {
            this._type = null;
            return;
        }

        let functionSymbol = this.symbolStore.match(name, SymbolKind.Function).shift();
        if (functionSymbol && functionSymbol.value.type && !functionSymbol.value.type.isEmpty()) {
            this._type = functionSymbol.value.type;
        } else {
            this._type = null;
        }

    }

    private _methodCall(node: Tree<Phrase | Token>) {

        let methodNameToken = node.children[1].value as Token;
        if (!methodNameToken || !this._type) {
            this._type = null;
            return;
        }

        let methodSymbols = this._lookupMemberSymbols(
            this._type.atomicClassArray(),
            methodNameToken.text,
            SymbolKind.Method
        );

        this._type = this._mergeTypes(methodSymbols);

    }

    private _property(node: Tree<Phrase | Token>) {

        let propName = variableNodeToString(node.children[1]);
        if (!propName || !this._type) {
            return null;
        }

        let propSymbols = this._lookupMemberSymbols(
            this._type.atomicClassArray(),
            propName,
            SymbolKind.Property
        );

        this._type = this._mergeTypes(propSymbols);

    }

    private _variable(node: Tree<Phrase | Token>) {

        let child = node.children[0] as Tree<Token>;

        if (!child.value || child.value.tokenType !== TokenType.T_VARIABLE) {
            this._type = null;
        }

        this._type = this._lookupVariableTypeDelegate(node);

    }

    private _name(node: Tree<Phrase | Token>) {
        let name = nameNodeToFqnString(node, this.nameResolver, SymbolKind.Class);
        if (name) {
            this._type = new TypeString(name);
        } else {
            this._type = null;
        }
    }

    private _lookupMemberSymbols(typeNames: string[], memberName: string, kind: SymbolKind) {

        let member: Tree<PhpSymbol>;
        let members: Tree<PhpSymbol>[] = [];

        for (let n = 0; n < typeNames.length; ++n) {

            member = this.symbolStore.lookupTypeMember(typeNames[n], kind, memberName);
            if (member) {
                members.push(member);
            }

        }

        return members;

    }

    private _mergeTypes(symbols: Tree<PhpSymbol>[]) {

        let type: TypeString = null;
        let symbol: PhpSymbol;

        for (let n = 0; n < symbols.length; ++n) {
            symbol = symbols[n].value;
            if (symbol.type) {
                type = type ? type.merge(symbol.type) : symbol.type;
            }
        }

        return type;
    }

}

export namespace ExpressionResolver {

    export var nameResolver:NameResolver;
    export var lookupVariableTypeDelegate: LookupVariableTypeDelegate;
    export var textDocument:TextDocument;



    export function simpleVariable(node:SimpleVariable){
        if(!node.name || (<Token>node.name).tokenType !== TokenType.VariableName){
            return null;
        }

        return lookupVariableTypeDelegate(textDocument.node.name)
    }


}
