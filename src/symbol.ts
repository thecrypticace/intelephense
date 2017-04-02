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
    TraitUseClause, SimpleVariable, ObjectCreationExpression, TypeDesignator, SubscriptExpression,
    FunctionCallExpression, FullyQualifiedName, RelativeQualifiedName, MethodCallExpression,
    MemberName, PropertyAccessExpression, ClassTypeDesignator
} from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
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
    Namespace = 1 << 9,
    ClassConstant = 1 << 10
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
        public document: ParsedDocument,
        public importedSymbols: PhpSymbol[],
        public namespaceName: string,
        public thisName: string,
        public thisBaseName: string
    ) { }

    resolveRelative(relativeName: string) {
        if (!relativeName) {
            return '';
        }
        return this.namespaceName ? this.namespaceName + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {

        if (!notFqName) {
            return '';
        }

        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }

        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(name, pos);
    }

    namespaceNameText(node: NamespaceName, endOffset?: number) {

        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }

        let parts: string[] = [];
        let t: Token;
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            t = node.parts[n];
            if (endOffset && ParsedDocument.isOffsetInToken(endOffset, t)) {
                parts.push(this.document.tokenText(t).substr(0, endOffset + 1 - t.offset));
                break;
            }
            parts.push(this.document.tokenText(node.parts[n]));
        }

        return parts.join('\\');

    }

    qualifiedNameText(node: FullyQualifiedName | QualifiedName | RelativeQualifiedName,
        kind: SymbolKind, endOffset?: number) {

        if (!node || !node.name) {
            return '';
        }

        let name = this.namespaceNameText(node.name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return this.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
            default:
                return name;
        }

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

    static create(parsedDocument: ParsedDocument) {

        let symbolReader = new SymbolReader(
            parsedDocument,
            new NameResolver(parsedDocument, [], '', '', ''),
            [{ kind: SymbolKind.None, name: '', children: [] }]
        );

        parsedDocument.traverse(symbolReader);
        return new SymbolTable(
            parsedDocument.uri,
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

    onParsedDocumentChange = (args: ParsedDocumentChangeEventArgs) => {
        this.remove(args.parsedDocument.uri);
        this.add(SymbolTable.create(args.parsedDocument));
    };

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
     * As per match but returns first item in result
     * @param text 
     * @param kindMask 
     */
    find(text: string, filter?: Predicate<PhpSymbol>) {
        return this.match(text, filter).shift();
    }

    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text: string, filter?: Predicate<PhpSymbol>) {

        if (!text) {
            return [];
        }

        let matched = this._index.match(text);

        if (!filter) {
            return matched;
        }

        let filtered: PhpSymbol[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    private _classOrInterfaceFilter(s: PhpSymbol) {
        return (s.kind & (SymbolKind.Class | SymbolKind.Interface)) > 0;
    }

    lookupTypeMembers(typeName: string, memberPredicate: Predicate<PhpSymbol>) {
        let type = this.match(typeName, this._classOrInterfaceFilter).shift();
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
            baseSymbol = this.match(baseSymbol.name, (x) => {
                return x.kind === baseSymbol.kind;
            }).shift();
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, basePredicate));
            }

        }

        return members;
    }

    private _indexSymbols(root: PhpSymbol) {

        let traverser = new TreeTraverser([root]);
        return traverser.filter(this._indexFilter);

    }

    private _indexFilter(s: PhpSymbol) {
        return s.kind !== SymbolKind.Parameter &&
            (s.kind !== SymbolKind.Variable || !s.scope) &&
            s.name.length > 0;
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
        public parsedDocument: ParsedDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) { }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let s: PhpSymbol;

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                s = this.namespaceDefinition(<NamespaceDefinition>node);
                this.nameResolver.namespaceName = s.name;
                this._addSymbol(s, false);
                return true;

            case PhraseType.NamespaceUseDeclaration:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    this.namespaceUseDeclaration(<NamespaceUseDeclaration>node);
                return true;

            case PhraseType.NamespaceUseClause:
                s = this.namespaceUseClause(<NamespaceUseClause>node,
                    this.namespaceUseDeclarationKind,
                    this.namespaceUseDeclarationPrefix
                );
                this._addSymbol(s, false);
                if (s.associated && s.associated.length > 0 && s.name) {
                    this.nameResolver.importedSymbols.push(s);
                }
                return false;

            case PhraseType.ConstElement:
                this._addSymbol(this.constElement(<ConstElement>node, this.lastPhpDoc), false);
                return false;

            case PhraseType.FunctionDeclaration:
                this._addSymbol(
                    this.functionDeclaration(<FunctionDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.FunctionDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    this.functionDeclarationHeader(<FunctionDeclarationHeader>node);
                return true;

            case PhraseType.ParameterDeclaration:
                this._addSymbol(
                    this.parameterDeclaration(<ParameterDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.TypeDeclaration:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = this.typeDeclaration(<TypeDeclaration>node);
                s.type = s.type ? s.type.merge(typeDeclarationValue) : new TypeString(typeDeclarationValue);
                return false;

            case PhraseType.ClassDeclaration:
                this._addSymbol(
                    this.classDeclaration(<ClassDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.ClassDeclarationHeader:
                this.classDeclarationHeader(
                    this.spine[this.spine.length - 1],
                    <ClassDeclarationHeader>node
                );
                return true;

            case PhraseType.ClassBaseClause:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = this.classBaseClause(<ClassBaseClause>node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                } else {
                    s.associated = [classBaseClause];
                }
                return false;

            case PhraseType.ClassInterfaceClause:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = this.classInterfaceClause(<ClassInterfaceClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                } else {
                    s.associated = classInterfaceClause;
                }
                return false;

            case PhraseType.InterfaceDeclaration:
                this._addSymbol(
                    this.interfaceDeclaration(<InterfaceDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.InterfaceDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    this.interfaceDeclarationHeader(<InterfaceDeclarationHeader>node);
                return false;

            case PhraseType.InterfaceBaseClause:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = this.interfaceBaseClause(<InterfaceBaseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                } else {
                    s.associated = interfaceBaseClause;
                }
                return false;

            case PhraseType.TraitDeclaration:
                this._addSymbol(
                    this.traitDeclaration(<TraitDeclaration>node, this.lastPhpDoc, this.lastPhpDocLocation),
                    true
                );
                return true;

            case PhraseType.TraitDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    this.traitDeclarationHeader(<TraitDeclarationHeader>node);
                return false;

            case PhraseType.ClassConstDeclaration:
                this.classConstDeclarationModifier =
                    this.classConstantDeclaration(<ClassConstDeclaration>node);
                return true;

            case PhraseType.ClassConstElement:
                this._addSymbol(
                    this.classConstElement(
                        this.classConstDeclarationModifier,
                        <ClassConstElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.PropertyDeclaration:
                this.propertyDeclarationModifier =
                    this.propertyDeclaration(<PropertyDeclaration>node);
                return true;

            case PhraseType.PropertyElement:
                this._addSymbol(
                    this.propertyElement(
                        this.propertyDeclarationModifier,
                        <PropertyElement>node,
                        this.lastPhpDoc
                    ),
                    false
                );
                return false;

            case PhraseType.TraitUseClause:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = this.traitUseClause(<TraitUseClause>node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                } else {
                    s.associated = traitUseClause;
                }
                return false;

            case PhraseType.MethodDeclaration:
                this._addSymbol(
                    this.methodDeclaration(<MethodDeclaration>node, this.lastPhpDoc),
                    true
                );
                return true;

            case PhraseType.MethodDeclarationHeader:
                this.spine[this.spine.length - 1].name =
                    this.methodDeclarationHeader(<MethodDeclarationHeader>node);
                return true;

            case PhraseType.MemberModifierList:
                this.spine[this.spine.length - 1].modifiers =
                    this.memberModifierList(<MemberModifierList>node);
                return false;

            case PhraseType.AnonymousClassDeclaration:
                this._addSymbol(
                    this.anonymousClassDeclaration(<AnonymousClassDeclaration>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionCreationExpression:
                this._addSymbol(
                    this.anonymousFunctionCreationExpression(<AnonymousFunctionCreationExpression>node),
                    true
                );
                return true;

            case PhraseType.AnonymousFunctionUseVariable:
                this._addSymbol(
                    this.anonymousFunctionUseVariable(<AnonymousFunctionUseVariable>node),
                    false
                );
                return false;

            case PhraseType.SimpleVariable:
                s = this.simpleVariable(<SimpleVariable>node);
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
        let s: PhpSymbol;

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
                let phpDocTokenText = this.parsedDocument.tokenText(t);
                this.lastPhpDoc = PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = {
                    uri: this.parsedDocument.uri,
                    range: {
                        start: this.parsedDocument.positionAtOffset(t.offset),
                        end: this.parsedDocument.positionAtOffset(t.offset + phpDocTokenText.length)
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

    nameTokenToFqn(t: Token) {
        let name = this.parsedDocument.tokenText(t);
        return name ? this.nameResolver.resolveRelative(name) : '';
    }

    phraseLocation(p: Phrase) {
        if (!p) {
            return null;
        }

        let range = this.parsedDocument.phraseRange(p);

        if (!range) {
            return null;
        }

        return <Location>{
            uri: this.parsedDocument.uri,
            range: range
        }
    }

    functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: '',
            location: this.phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }

        return s;

    }

    functionDeclarationHeader(node: FunctionDeclarationHeader) {
        return this.nameTokenToFqn(node.name);
    }

    parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Parameter,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
                s.type = s.type ? s.type.merge(type) : type;
            }
        }

        return s;
    }

    typeDeclaration(node: TypeDeclaration) {

        return (<Phrase>node.name).phraseType ?
            this.qualifiedName(<QualifiedName>node.name, SymbolKind.Class) :
            this.parsedDocument.tokenText(<Token>node.name);

    }

    qualifiedName(node: QualifiedName, kind: SymbolKind) {
        if (!node || !node.name) {
            return '';
        }

        let name = this.parsedDocument.namespaceNameToString(node.name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
            default:
                return name;
        }
    }

    constElement(node: ConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Constant,
            name: this.nameTokenToFqn(node.name),
            location: this.phraseLocation(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }

        return s;

    }

    classConstantDeclaration(node: ClassConstDeclaration) {
        return node.modifierList ?
            this.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.ClassConstant,
            modifiers: modifiers,
            name: this.identifier(node.name),
            location: this.phraseLocation(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }

        return s;

    }

    methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            name: '',
            location: this.phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }

        return s;

    }

    memberModifierList(node: MemberModifierList) {
        return this.modifierListElementsToSymbolModifier(node.elements);
    }

    methodDeclarationHeader(node: MethodDeclarationHeader) {
        return this.identifier(node.name);
    }

    propertyDeclaration(node: PropertyDeclaration) {
        return node.modifierList ?
            this.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            SymbolModifier.None;
    }

    propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Property,
            name: this.parsedDocument.tokenText(node.name),
            modifiers: modifiers,
            location: this.phraseLocation(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }

        return s;

    }

    identifier(node: Identifier) {
        return this.parsedDocument.tokenText(node.name);
    }

    interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Interface,
            name: '',
            location: this.phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    phpDocMembers(phpDoc: PhpDoc, phpDocLoc: Location) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.propertyTagToSymbol(magic[n], phpDocLoc));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.methodTagToSymbol(magic[n], phpDocLoc));
        }

        return symbols;
    }

    methodTagToSymbol(tag: Tag, phpDocLoc: Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            modifiers: SymbolModifier.Magic,
            name: tag.name,
            type: new TypeString(tag.typeString).nameResolve(this.nameResolver),
            description: tag.description,
            children: [],
            location: phpDocLoc
        };

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(this.magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }

        return s;
    }

    magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc: Location) {

        return <PhpSymbol>{
            kind: SymbolKind.Parameter,
            name: p.name,
            modifiers: SymbolModifier.Magic,
            type: new TypeString(p.typeString).nameResolve(this.nameResolver),
            location: phpDocLoc
        }

    }

    propertyTagToSymbol(t: Tag, phpDocLoc: Location) {
        return <PhpSymbol>{
            kind: SymbolKind.Property,
            name: t.name,
            modifiers: this.magicPropertyModifier(t) | SymbolModifier.Magic,
            type: new TypeString(t.typeString).nameResolve(this.nameResolver),
            description: t.description,
            location: phpDocLoc
        };
    }

    magicPropertyModifier(t: Tag) {
        switch (t.tagName) {
            case '@property-read':
                return SymbolModifier.ReadOnly;
            case '@property-write':
                return SymbolModifier.WriteOnly;
            default:
                return SymbolModifier.None;
        }
    }

    interfaceDeclarationHeader(node: InterfaceDeclarationHeader) {
        return this.nameTokenToFqn(node.name);
    }

    interfaceBaseClause(node: InterfaceBaseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            };
        }
        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {
        let s: PhpSymbol = {
            kind: SymbolKind.Trait,
            name: '',
            location: this.phraseLocation(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;
    }

    traitDeclarationHeader(node: TraitDeclarationHeader) {
        return this.nameTokenToFqn(node.name);
    }

    classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc, phpDocLoc: Location) {

        let s: PhpSymbol = {
            kind: SymbolKind.Class,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }

        return s;

    }

    classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader) {

        if (node.modifier) {
            s.modifiers = this.modifierTokenToSymbolModifier(node.modifier);
        }

        s.name = this.nameTokenToFqn(node.name);
        return s;

    }

    classBaseClause(node: ClassBaseClause) {
        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: this.qualifiedName(node.name, SymbolKind.Class)
        };
    }

    classInterfaceClause(node: ClassInterfaceClause) {

        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Interface,
                name: name
            }
        }

        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);

    }

    traitUseClause(node: TraitUseClause) {
        let mapFn = (name: string) => {
            return <PhpSymbol>{
                kind: SymbolKind.Trait,
                name: name
            };
        };

        return this.qualifiedNameList(node.nameList).map<PhpSymbol>(mapFn);
    }

    anonymousClassDeclaration(node: AnonymousClassDeclaration) {

        return <PhpSymbol>{
            kind: SymbolKind.Class,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: this.phraseLocation(node)
        };
    }

    anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression) {

        return <PhpSymbol>{
            kind: SymbolKind.Function,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            location: this.phraseLocation(node)
        };

    }

    anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable) {
        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
    }

    simpleVariable(node: SimpleVariable) {
        if (!ParsedDocument.isToken(node, [TokenType.VariableName])) {
            return null;
        }

        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: this.parsedDocument.tokenText(<Token>node.name),
            location: this.phraseLocation(node)
        };
    }

    qualifiedNameList(node: QualifiedNameList) {

        let names: string[] = [];
        let name: string;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = this.qualifiedName(node.elements[n], SymbolKind.Class);
            if (name) {
                names.push(name);
            }
        }
        return names;

    }

    modifierListElementsToSymbolModifier(tokens: Token[]) {

        let flag = SymbolModifier.None;
        if (!tokens || tokens.length < 1) {
            return flag
        }

        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= this.modifierTokenToSymbolModifier(tokens[n]);
        }

        return flag;
    }

    modifierTokenToSymbolModifier(t: Token) {

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

    concatNamespaceName(prefix: string, name: string) {
        if (!name) {
            return null;
        } else if (!prefix) {
            return name;
        } else {
            return prefix + '\\' + name;
        }
    }

    namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let s: PhpSymbol = {
            kind: kind ? kind : SymbolKind.Class,
            name: node.aliasingClause ? this.parsedDocument.tokenText(node.aliasingClause.alias) : null,
            associated: [],
            location: this.phraseLocation(node)
        };

        let fqn = this.concatNamespaceName(prefix, this.parsedDocument.namespaceNameToString(node.name));
        if (!fqn) {
            return s;
        }

        s.associated.push({ kind: s.kind, name: fqn });
        if (!node.aliasingClause) {
            s.name = fqn.split('\\').pop();
        }

        return s;

    }

    tokenToSymbolKind(t: Token) {
        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string] {

        return [
            node.kind ? this.tokenToSymbolKind(node.kind) : SymbolKind.None,
            node.prefix ? this.parsedDocument.namespaceNameToString(node.prefix) : null
        ];

    }

    namespaceDefinition(node: NamespaceDefinition) {

        return <PhpSymbol>{
            kind: SymbolKind.Namespace,
            name: this.parsedDocument.namespaceNameToString(node.name),
            location: this.phraseLocation(node),
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

function resolveNamePhraseFqn(p: Phrase, nameResolver: NameResolver, parsedDocument: ParsedDocument, symbolKind: SymbolKind) {
    switch (p.phraseType) {
        case PhraseType.RelativeQualifiedName:
            return nameResolver.resolveRelative(
                parsedDocument.namespaceNameToString((<FullyQualifiedName>p).name));
        case PhraseType.QualifiedName:
            return nameResolver.resolveNotFullyQualified(
                parsedDocument.namespaceNameToString((<FullyQualifiedName>p).name), symbolKind);
        case PhraseType.FullyQualifiedName:
            return parsedDocument.namespaceNameToString((<FullyQualifiedName>p).name);
        default:
            return '';
    }
}

export class ExpressionResolver {

    constructor(
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public parsedDocument: ParsedDocument,
        public lookupVariableTypeDelegate: LookupVariableTypeDelegate) {

    }

    resolveExpression(node: Phrase | Token): TypeString {

        if (!node) {
            return new TypeString('');
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.SimpleVariable:
                return this.simpleVariable(<SimpleVariable>node);
            case PhraseType.SubscriptExpression:
                return this.subscriptExpression(<SubscriptExpression>node);
            case PhraseType.ScopedCallExpression:
            case PhraseType.ScopedPropertyAccessExpression:

            case PhraseType.PropertyAccessExpression:
                return this.propertyAccessExpression(<PropertyAccessExpression>node);
            case PhraseType.FunctionCallExpression:
                return this.functionCallExpression(<FunctionCallExpression>node);
            case PhraseType.TernaryExpression:

            case PhraseType.MethodCallExpression:
                return this.methodCallExpression(<MethodCallExpression>node);
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:

            case PhraseType.ObjectCreationExpression:

            case PhraseType.ClassTypeDesignator:
            case PhraseType.InstanceofTypeDesignator:

            default:
                return null;
        }

    }

    classTypeDesignator(node: ClassTypeDesignator) {

        if (!node.type) {
            return null;
        }


    }

    objectCreationExpression(node: ObjectCreationExpression) {

        if (!node.type) {
            return null;
        }

        if (node.type.phraseType === PhraseType.AnonymousClassDeclaration) {
            return this.parsedDocument.createAnonymousName(node);
        } else if (node.type.phraseType === PhraseType.ClassTypeDesignator) {
            return this.classTypeDesignator(<ClassTypeDesignator>node.type);
        } else {
            return null;
        }

    }

    anonymousClassDeclaration(node: AnonymousClassDeclaration) {

    }

    simpleVariable(node: SimpleVariable) {
        if (!node.name || (<Token>node.name).tokenType !== TokenType.VariableName) {
            return null;
        }

        return this.lookupVariableTypeDelegate(this.parsedDocument.tokenText((<Token>node.name)));
    }

    subscriptExpression(node: SubscriptExpression) {
        let type = this.resolveExpression(node.dereferencable);
        return type ? type.arrayDereference() : null;
    }

    functionCallExpression(node: FunctionCallExpression) {

        let qName = <Phrase>node.callableExpr;
        if (ParsedDocument.isPhrase(qName,
            [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName])) {
            return null;
        }

        let functionName = resolveNamePhraseFqn(qName, this.nameResolver, this.parsedDocument, SymbolKind.Function);
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === SymbolKind.Function });
        return symbol && symbol.type ? symbol.type : null;

    }

    methodCallExpression(node: MethodCallExpression) {

        if (!node.memberName || node.variable) {
            return null;
        }

        let methodName = ParsedDocument.isToken(node.memberName) ?
            this.parsedDocument.tokenText(<Token>node.memberName) :
            this.memberName(<MemberName>node.memberName);

        let type = this.resolveExpression(node.variable);

        if (!methodName || !type) {
            return null;
        }

        return this.mergeTypes(this.lookupMemberSymbols(type.atomicClassArray(), methodName, SymbolKind.Method));

    }

    memberName(node: MemberName) {
        return this.parsedDocument.tokenText((<Token>node.name));
    }

    propertyAccessExpression(node: PropertyAccessExpression) {

        if (!node.memberName || !node.variable) {
            return null;
        }

        let propName = ParsedDocument.isToken(node.memberName) ?
            this.parsedDocument.tokenText(<Token>node.memberName) :
            this.memberName(<MemberName>node.memberName);

        let type = this.resolveExpression(node.variable);

        if (!propName || !type) {
            return null;
        }

        let propSymbols = this.lookupMemberSymbols(type.atomicClassArray(), propName, SymbolKind.Property);
        return this.mergeTypes(propSymbols);

    }

    lookupMemberSymbols(typeNames: string[], memberName: string, kind: SymbolKind) {

        let member: PhpSymbol;
        let members: PhpSymbol[] = [];
        let memberPredicate: Predicate<PhpSymbol> = (x) => {
            return kind === x.kind && memberName === x.name;
        }

        for (let n = 0, l = typeNames.length; n < l; ++n) {

            member = this.symbolStore.lookupTypeMember(typeNames[n], memberPredicate);
            if (member) {
                members.push(member);
            }

        }

        return members;

    }

    mergeTypes(symbols: PhpSymbol[]) {

        let type = new TypeString('');
        let symbol: PhpSymbol;

        for (let n = 0, l = symbols.length; n < l; ++n) {
            symbol = symbols[n];
            if (symbol.type) {
                type = type.merge(symbol.type);
            }
        }

        return type;
    }

}

