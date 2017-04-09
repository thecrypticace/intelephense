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
    MemberName, PropertyAccessExpression, ClassTypeDesignator, ScopedCallExpression,
    ScopedMemberName, ScopedPropertyAccessExpression, BinaryExpression, TernaryExpression,
    RelativeScope, ListIntrinsic, IfStatement, InstanceOfExpression, InstanceofTypeDesignator,
    ArrayInitialiserList, ArrayElement, ForeachStatement
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

/*
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
     *
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
    

}*/

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

        if (notFqName === 'parent') {
            return this.thisBaseName;
        }

        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(name, pos);
    }

    createAnonymousName(node: Phrase) {
        return this.document.createAnonymousName(node);
    }

    namespaceNamePhraseText(node: NamespaceName, endOffset?: number) {

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

    qualifiedNamePhraseText(node: FullyQualifiedName | QualifiedName | RelativeQualifiedName,
        kind: SymbolKind) {

        if (!node || !node.name) {
            return '';
        }

        let name = this.namespaceNamePhraseText(node.name);
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

    tokenText(t: Token, endOffset?: number) {
        let text = this.document.tokenText(t).slice();
        if (endOffset) {
            text = text.substr(0, endOffset + 1 - t.offset);
        }
        return text;
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

        if (!type) {
            return this;
        }

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

    find(predicate: Predicate<PhpSymbol>) {
        let traverser = new TreeTraverser([this.root]);
        return traverser.find(predicate);
    }

    symbolAtPosition(position: Position) {

        let pred = (x: PhpSymbol) => {
            return x.location &&
                x.location.range.start.line === position.line &&
                x.location.range.start.character === position.character;
        };

        return this.filter(pred).pop();
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

export interface MemberQuery {
    typeName: string;
    memberPredicate: Predicate<PhpSymbol>;
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
    match(text: string, filter?: Predicate<PhpSymbol>, fuzzy?:boolean) {

        if (!text) {
            return [];
        }

        let matched = this._index.match(text, fuzzy);

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

    lookupTypeMembers(query: MemberQuery) {
        let type = this.match(query.typeName, this._classOrInterfaceFilter).shift();
        return this._lookupTypeMembers(type, query.memberPredicate);
    }

    lookupTypeMember(query: MemberQuery) {
        return this.lookupTypeMembers(query).shift();
    }

    lookupMembersOnTypes(queries: MemberQuery[]) {
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = queries.length; n < l; ++n) {
            Array.prototype.push.apply(symbols, this.lookupTypeMembers(queries[n]));
        }

        return symbols;
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
                this.functionDeclarationHeader(this._top(), <FunctionDeclarationHeader>node);
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
                this.interfaceDeclarationHeader(this._top(), <InterfaceDeclarationHeader>node);
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
                this.methodDeclarationHeader(this._top(), <MethodDeclarationHeader>node);
                return true;

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
            case PhraseType.PropertyDeclaration:
                this.propertyDeclarationModifier = 0;
                break;
            case PhraseType.ClassConstDeclaration:
                this.classConstDeclarationModifier = 0;
                break;
            case PhraseType.NamespaceUseDeclaration:
                this.namespaceUseDeclarationKind = 0;
                this.namespaceUseDeclarationPrefix = '';
                break;
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.AnonymousFunctionHeader:
            case PhraseType.AnonymousClassDeclarationHeader:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }

    }

    private _top() {
        return this.spine[this.spine.length - 1];
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

    functionDeclarationHeader(s: PhpSymbol, node: FunctionDeclarationHeader) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
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
            SymbolModifier.Public;
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

    methodDeclarationHeader(s: PhpSymbol, node: MethodDeclarationHeader) {
        s.name = this.identifier(node.name);
        if(node.modifierList){
            s.modifiers = this.memberModifierList(node.modifierList);
        }
        
        return s;
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

    interfaceDeclarationHeader(s: PhpSymbol, node: InterfaceDeclarationHeader) {
        s.name = this.nameTokenToFqn(node.name);
        return s;
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
            location: this.phraseLocation(node),
            modifiers: SymbolModifier.Use
        };
    }

    simpleVariable(node: SimpleVariable) {
        if (!ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
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
            return flag;
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

        let suffixes = this._symbolKeys(item);
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

        let suffixes = this._symbolKeys(item);
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

    match(text: string, fuzzy?: boolean) {

        let substrings: string[];
        if (fuzzy) {
            substrings = util.trigrams(text);
            if (text.length > 3 || text.length < 3) {
                substrings.unshift(text);
            }
            
        } else {
            substrings = [text];
        }

        let nodes: SymbolIndexNode[] = [];

        for (let n = 0, l = substrings.length; n < l; ++n) {
            Array.prototype.push.apply(nodes, this._nodeMatch(text));
        }

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

    private _symbolKeys(s: PhpSymbol) {

        let keys: string[] = [];
        let nsSeparatorPos = s.name.lastIndexOf('\\');
        let name = s.name;
        if (nsSeparatorPos > -1) {
            keys.push(name.toLowerCase());
            name = name.slice(nsSeparatorPos + 1);
        }

        Array.prototype.push.apply(keys, util.trigrams(name));
        if (name.length > 3 || name.length < 3) {
            keys.push(name.toLowerCase());
        }

        let acronym = util.acronym(name);
        if (acronym.length > 1) {
            keys.push(acronym);
        }
        return keys;
    }

}

interface SymbolIndexNode {
    key: string;
    items: PhpSymbol[];
}

export interface LookupVariableTypeDelegate {
    (t: Token): TypeString;
}

export class ExpressionTypeResolver {

    constructor(
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public variableTable: VariableTable) {

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
                return this.scopedMemberAccessExpression(<ScopedCallExpression>node, SymbolKind.Method);
            case PhraseType.ScopedPropertyAccessExpression:
                return this.scopedMemberAccessExpression(<ScopedPropertyAccessExpression>node, SymbolKind.Property);
            case PhraseType.PropertyAccessExpression:
                return this.instanceMemberAccessExpression(<PropertyAccessExpression>node, SymbolKind.Property);
            case PhraseType.MethodCallExpression:
                return this.instanceMemberAccessExpression(<MethodCallExpression>node, SymbolKind.Method);
            case PhraseType.FunctionCallExpression:
                return this.functionCallExpression(<FunctionCallExpression>node);
            case PhraseType.TernaryExpression:
                return this.ternaryExpression(<TernaryExpression>node);
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                return this.resolveExpression((<BinaryExpression>node).right);
            case PhraseType.ObjectCreationExpression:
                return this.objectCreationExpression(<ObjectCreationExpression>node);
            case PhraseType.ClassTypeDesignator:
            case PhraseType.InstanceofTypeDesignator:
                return this.classTypeDesignator(<any>node);
            case PhraseType.AnonymousClassDeclaration:
                return new TypeString(this.nameResolver.createAnonymousName(<AnonymousClassDeclaration>node));
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
                return new TypeString(this.nameResolver.qualifiedNamePhraseText(<any>node, SymbolKind.Class));
            case PhraseType.RelativeScope:
                return new TypeString(this.nameResolver.thisName);
            default:
                return new TypeString('');
        }

    }

    ternaryExpression(node: TernaryExpression) {

        return new TypeString('')
            .merge(this.resolveExpression(node.trueExpr))
            .merge(this.resolveExpression(node.falseExpr));

    }

    scopedMemberAccessExpression(node: ScopedPropertyAccessExpression | ScopedCallExpression, kind: SymbolKind) {

        let memberName = this.scopedMemberName(node.memberName);
        let scopeTypeString = this.resolveExpression(node.scope);

        if (!scopeTypeString || scopeTypeString.isEmpty() || !memberName) {
            return new TypeString('');
        }

        let typeNames = scopeTypeString.atomicClassArray();
        let symbols = this.lookupMemberOnTypes(typeNames, kind, memberName, SymbolModifier.Static, 0);
        return this.mergeTypes(symbols);

    }

    lookupMemberOnTypes(typeNames: string[], kind: SymbolKind, memberName: string, modifierMask: SymbolModifier, notModifierMask: SymbolModifier) {

        let symbols: PhpSymbol[] = [];
        let s: PhpSymbol;
        let visibilityNotModifierMask = 0;
        let typeName: string;

        for (let n = 0, l = typeNames.length; n < l; ++n) {

            typeName = typeNames[n];
            if (typeName === this.nameResolver.thisName) {
                visibilityNotModifierMask = 0;
            } else if (typeName === this.nameResolver.thisBaseName) {
                visibilityNotModifierMask = SymbolModifier.Private;
            } else {
                visibilityNotModifierMask = SymbolModifier.Private | SymbolModifier.Protected;
            }

            let memberPredicate = (x: PhpSymbol) => {
                return x.kind === kind &&
                    (!modifierMask || (x.modifiers & modifierMask) > 0) &&
                    !(visibilityNotModifierMask & x.modifiers) &&
                    !(notModifierMask & x.modifiers) &&
                    x.name === memberName;
            }

            s = this.symbolStore.lookupTypeMember({ typeName: typeName, memberPredicate: memberPredicate });
            if (s) {
                symbols.push(s);
            }
        }

        return symbols;

    }

    scopedMemberName(node: ScopedMemberName) {

        if (node && ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
            return this.nameResolver.tokenText(<Token>node.name);
        } else if (node && ParsedDocument.isPhrase(node.name, [PhraseType.Identifier])) {
            return this.nameResolver.tokenText((<Identifier>node.name).name);
        }

        return '';
    }

    classTypeDesignator(node: ClassTypeDesignator) {

        if (node && ParsedDocument.isPhrase(node.type,
            [PhraseType.QualifiedName | PhraseType.FullyQualifiedName | PhraseType.RelativeQualifiedName])) {
            return new TypeString(this.nameResolver.qualifiedNamePhraseText(<any>node.type, SymbolKind.Class));
        } else if (node && ParsedDocument.isPhrase(node.type, [PhraseType.RelativeScope])) {
            return new TypeString(this.nameResolver.thisName);
        } else {
            return new TypeString('');
        }

    }

    objectCreationExpression(node: ObjectCreationExpression) {

        if (ParsedDocument.isPhrase(node.type, [PhraseType.AnonymousClassDeclaration])) {
            return new TypeString(this.nameResolver.createAnonymousName(node));
        } else if (ParsedDocument.isPhrase(node.type, [PhraseType.ClassTypeDesignator])) {
            return this.classTypeDesignator(<ClassTypeDesignator>node.type);
        } else {
            return new TypeString('');
        }

    }

    simpleVariable(node: SimpleVariable) {
        if (ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
            return this.variableTable.getType(this.nameResolver.tokenText(<Token>node.name), this.nameResolver.thisName);
        }

        return new TypeString('');
    }

    subscriptExpression(node: SubscriptExpression) {
        let type = this.resolveExpression(node.dereferencable);
        return type ? type.arrayDereference() : new TypeString('');
    }

    functionCallExpression(node: FunctionCallExpression) {

        let qName = <Phrase>node.callableExpr;
        if (!ParsedDocument.isPhrase(qName,
            [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName])) {
            return new TypeString('');
        }

        let functionName = this.nameResolver.qualifiedNamePhraseText(<any>qName, SymbolKind.Function)
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === SymbolKind.Function });
        return symbol && symbol.type ? symbol.type : new TypeString('');

    }

    memberName(node: MemberName) {
        return node ? this.nameResolver.tokenText((<Token>node.name)) : '';
    }

    instanceMemberAccessExpression(node: PropertyAccessExpression, kind: SymbolKind) {

        let memberName = ParsedDocument.isToken(node.memberName) ?
            this.nameResolver.tokenText(<Token>node.memberName) :
            this.memberName(<MemberName>node.memberName);

        let type = this.resolveExpression(node.variable);

        if (!memberName || !type) {
            return new TypeString('');
        }

        let symbols = this.lookupMemberOnTypes(type.atomicClassArray(), kind, memberName, 0, SymbolModifier.Static);
        return this.mergeTypes(symbols);

    }

    mergeTypes(symbols: PhpSymbol[]) {

        let type = new TypeString('');
        let symbol: PhpSymbol;

        for (let n = 0, l = symbols.length; n < l; ++n) {
            type = type.merge(symbols[n].type);
        }

        return !type.isEmpty() ? type : new TypeString('');
    }

}

export class VariableTypeResolver implements TreeVisitor<Phrase | Token>{

    private _haltAtNode: Phrase | Token;
    private _varName: string;

    haltTraverse: boolean;

    constructor(public variableTable: VariableTable,
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        haltAtNode?: Phrase | Token) {
        this._haltAtNode = haltAtNode;
        this.haltTraverse = false;
    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this._haltAtNode === node) {
            this.haltTraverse = true;
            return false;
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclaration:
                this._methodOrFunction(node, SymbolKind.Function);
                return true;
            case PhraseType.MethodDeclaration:
                this._methodOrFunction(node, SymbolKind.Method);
                return true;
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this.variableTable.pushScope();
                return true;
            case PhraseType.AnonymousFunctionCreationExpression:
                this._anonymousFunctionCreationExpression(node);
                return true;
            case PhraseType.IfStatement:
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseIfClause:
                this.variableTable.pushBranch();
                return true;
            case PhraseType.ElseClause:
                let elseClauseParent = spine[spine.length - 1];
                if (!(<IfStatement>elseClauseParent).elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pushBranch();
                return true;
            case PhraseType.ElseIfClauseList:
                this.variableTable.popBranch(); //pop the if branch
                return true;
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                if (ParsedDocument.isPhrase((<BinaryExpression>node).left, [PhraseType.SimpleVariable, PhraseType.ListIntrinsic])) {
                    this._assignmentExpression(<BinaryExpression>node);
                    return false;
                }
                return true;
            case PhraseType.InstanceOfExpression:
                this._instanceOfExpression(<InstanceOfExpression>node);
                return false;
            case PhraseType.ForeachStatement:
                this._foreachStatement(<ForeachStatement>node);
                return true;
            case undefined:
                this._token(<Token>node);
                return false;
            default:
                return true;
        }

    }

    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.IfStatement:
                if (!(<IfStatement>node).elseClause && !(<IfStatement>node).elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pruneBranches();
                break;
            case PhraseType.SwitchStatement:
                this.variableTable.pruneBranches();
                break;
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseClause:
            case PhraseType.ElseIfClause:
                this.variableTable.popBranch();
                break;
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this.variableTable.popScope();
                break;
            default:
                break;
        }

    }

    private _listIntrinsic(node: ListIntrinsic) {

        let elements = node.initialiserList.elements;
        let element: ArrayElement;
        let varNames: string[] = [];
        let varName: string;

        for (let n = 0, l = elements.length; n < l; ++n) {
            element = elements[n];
            varName = this._simpleVariable(<SimpleVariable>element.value.expr);
            if (varName) {
                varNames.push(varName);
            }
        }

        return varNames;

    }

    private _token(t: Token) {

        //doc block type hints
        if (t.tokenType === TokenType.DocumentComment) {
            let phpDoc = PhpDocParser.parse(this.document.tokenText(t));
            if (phpDoc) {
                let varTags = phpDoc.varTags;
                let varTag: Tag;
                for (let n = 0, l = varTags.length; n < l; ++n) {
                    varTag = varTags[n];
                    this.variableTable.setType(varTag.name, new TypeString(varTag.typeString).nameResolve(this.nameResolver));
                }
            }
        }

    }

    private _parameterSymbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Parameter;
    }

    private _methodOrFunction(node: Phrase | Token, kind: SymbolKind) {

        this.variableTable.pushScope();
        let symbol = this._findSymbolForPhrase(<Phrase>node);

        if (symbol) {
            let params = symbol.children.filter(this._parameterSymbolFilter);
            let param: PhpSymbol;
            for (let n = 0, l = params.length; n < l; ++n) {
                param = params[n];
                this.variableTable.setType(param.name, param.type);
            }
        }

    }

    private _findSymbolForPhrase(p: Phrase) {

        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let range = this.document.phraseRange(p);
        let predicate = (x: PhpSymbol) => {
            return x.location &&
                x.location.range.start.line === range.start.line &&
                x.location.range.start.character === range.start.character;
        };
        return symbolTable.find(predicate);

    }

    private _anonymousFunctionUseVariableSymbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Variable && (s.modifiers & SymbolModifier.Use) > 0;
    }

    private _anonymousFunctionCreationExpression(node: Phrase | Token) {

        let symbol = this._findSymbolForPhrase(<Phrase>node);

        let carry: string[] = [];
        if (symbol) {

            let useVariables = symbol.children.filter(this._anonymousFunctionUseVariableSymbolFilter);

            for (let n = 0, l = useVariables.length; n < l; ++n) {
                carry.push(useVariables[n].name);
            }

        }

        this.variableTable.pushScope(carry);
    }

    private _simpleVariable(node: SimpleVariable) {
        return this._isNonDynamicSimpleVariable(node) ? this.nameResolver.tokenText(<Token>node.name) : '';
    }

    private _instanceOfExpression(node: InstanceOfExpression) {

        let lhs = node.left as SimpleVariable;
        let rhs = node.right as InstanceofTypeDesignator;
        let varName = this._simpleVariable(lhs);
        let exprTypeResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        this.variableTable.setType(varName, exprTypeResolver.resolveExpression(rhs));

    }

    private _isNonDynamicSimpleVariable(node: Phrase | Token) {
        return ParsedDocument.isPhrase(node, [PhraseType.SimpleVariable]) &&
            ParsedDocument.isToken((<SimpleVariable>node).name, [TokenType.Name]);
    }

    private _assignmentExpression(node: BinaryExpression) {

        let lhs = node.left;
        let rhs = node.right;
        let exprTypeResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);

        if (ParsedDocument.isPhrase(lhs, [PhraseType.SimpleVariable])) {
            let varName = this._simpleVariable(<SimpleVariable>lhs);
            this.variableTable.setType(varName, exprTypeResolver.resolveExpression(rhs));
        } else if (ParsedDocument.isPhrase(node, [PhraseType.ListIntrinsic])) {
            let varNames = this._listIntrinsic(<ListIntrinsic>rhs);
            this.variableTable.setTypeMany(varNames, exprTypeResolver.resolveExpression(rhs).arrayDereference());
        }

    }

    private _foreachStatement(node: ForeachStatement) {

        let collection = node.collection;
        let value = node.value;

        let exprResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        let type = exprResolver.resolveExpression(collection).arrayDereference();

        if (ParsedDocument.isPhrase(value.expr, [PhraseType.SimpleVariable])) {
            let varName = this._simpleVariable(<SimpleVariable>value.expr);
            this.variableTable.setType(varName, type);
        } else if (ParsedDocument.isPhrase(value.expr, [PhraseType.ListIntrinsic])) {
            let varNames = this._listIntrinsic(<ListIntrinsic>value.expr);
            this.variableTable.setTypeMany(varNames, type.arrayDereference());
        }

    }

}

interface TypedVariable {
    name: string;
    type: TypeString;
}

const enum TypedVariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface TypedVariableSet {
    kind: TypedVariableSetKind;
    variables: { [index: string]: TypedVariable };
    branches: TypedVariableSet[];
}

export class VariableTable {

    private _typeVariableSetStack: TypedVariableSet[];

    constructor() {

        this._typeVariableSetStack = [{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }];
    }

    setType(varName: string, type: TypeString) {
        if (!varName || !type || type.isEmpty()) {
            return;
        }
        this._top().variables[varName] = { name: varName, type: type };
    }

    setTypeMany(varNames: string[], type: TypeString) {
        for (let n = 0, l = varNames.length; n < l; ++n) {
            this.setType(varNames[n], type);
        }
    }

    pushScope(carry?: string[]) {

        let scope = <TypedVariableSet>{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }

        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n], '');
                if (type) {
                    scope.variables[carry[n]] = { name: carry[n], type: type };
                }
            }
        }

        this._typeVariableSetStack.push(scope);

    }

    popScope() {
        this._typeVariableSetStack.pop();
    }

    pushBranch() {
        let b = <TypedVariableSet>{
            kind: TypedVariableSetKind.Branch,
            variables: {},
            branches: []
        };
        this._top().branches.push(b);
        this._typeVariableSetStack.push(b);
    }

    popBranch() {
        this._typeVariableSetStack.pop();
    }

    /**
     * consolidates variables. 
     * each variable can be any of types discovered in branches after this.
     */
    pruneBranches() {

        let node = this._top();
        let branches = node.branches;
        node.branches = [];
        for (let n = 0, l = branches.length; n < l; ++n) {
            this._mergeSets(node, branches[n]);
        }

    }

    getType(varName: string, thisName: string) {

        if (varName === '$this') {
            return new TypeString(thisName);
        }

        let typeSet: TypedVariableSet;

        for (let n = this._typeVariableSetStack.length - 1; n >= 0; --n) {
            typeSet = this._typeVariableSetStack[n];
            if (typeSet.variables[varName]) {
                return typeSet.variables[varName].type;
            }

            if (typeSet.kind === TypedVariableSetKind.Scope) {
                break;
            }
        }

        return null;

    }

    private _mergeSets(a: TypedVariableSet, b: TypedVariableSet) {

        let keys = Object.keys(b.variables);
        let typedVar: TypedVariable;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = a.variables[typedVar.name].type.merge(typedVar.type);
            } else {
                a.variables[typedVar.name] = typedVar;
            }
        }

    }

    private _top() {
        return this._typeVariableSetStack[this._typeVariableSetStack.length - 1];
    }

}
