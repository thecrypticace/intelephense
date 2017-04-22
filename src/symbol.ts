/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
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
    ArrayInitialiserList, ArrayElement, ForeachStatement, CatchClause
} from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
import * as util from './util';
import * as builtInSymbols from './builtInSymbols.json';

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
    value?: string;
    typeSource?: TypeSource;
}


export namespace PhpSymbol {

    function isParameter(s: PhpSymbol) {
        return s.kind === SymbolKind.Parameter;
    }

    export function signatureString(s: PhpSymbol) {

        if (!s || !(s.kind & (SymbolKind.Function | SymbolKind.Method))) {
            return '';
        }

        let params = s.children ? s.children.filter(isParameter) : [];
        let paramStrings: String[] = [];
        let param: PhpSymbol;
        let parts: string[];

        for (let n = 0, l = params.length; n < l; ++n) {
            param = params[n];
            parts = [];

            if (n) {
                parts.push(',');
            }

            if (param.type && !param.type.isEmpty()) {
                parts.push(param.type.toString());
            }

            parts.push(param.name);

            if (param.value) {
                paramStrings.push(`[${parts.join(' ')}]`);
            } else {
                paramStrings.push(parts.join(' '));
            }

        }

        let sig = `(${paramStrings.join('')})`;
        if (s.type && !s.type.isEmpty()) {
            sig += `: ${s.type}`;
        }
        return sig;

    }

    export function hasParameters(s: PhpSymbol) {
        return s.children && s.children.find(isParameter) !== undefined;
    }

    export function notFqn(text: string) {
        if (!text) {
            return text;
        }
        let pos = text.lastIndexOf('\\') + 1;
        return text.slice(pos);
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

        if (notFqName === 'parent') {
            return this.thisBaseName;
        }

        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(notFqName, pos);
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

    namePhraseToFqn(node: Phrase, kind: SymbolKind) {

        if (!ParsedDocument.isPhrase(node, [
            PhraseType.FullyQualifiedName, PhraseType.RelativeQualifiedName, PhraseType.QualifiedName
        ])) {
            return '';
        }

        let name = this.namespaceNamePhraseText((<any>node).name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return this.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
                return name;
            default:
                return '';
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

    static create(parsedDocument: ParsedDocument, ignorePhraseTypes?: PhraseType[]) {

        let symbolReader = new SymbolReader(
            parsedDocument,
            new NameResolver(parsedDocument, [], '', '', ''),
            [{ kind: SymbolKind.None, name: '', children: [] }]
        );
        symbolReader.ignore = ignorePhraseTypes;

        parsedDocument.traverse(symbolReader);
        return new SymbolTable(
            parsedDocument.uri,
            symbolReader.spine[0]
        );

    }

    static createBuiltIn() {

        builtInSymbolTypeStrings(<any>builtInSymbols);
        return new SymbolTable('\\', {
            kind: SymbolKind.None,
            name: '',
            children: <any>builtInSymbols
        });

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
     * As per match but returns first item in result that matches text exactly
     * @param text 
     * @param kindMask 
     */
    find(text: string, filter?: Predicate<PhpSymbol>) {
        let exactMatchFn = (x: PhpSymbol) => {
            return (!filter || filter(x)) && x.name === text;
        };
        return this.match(text, exactMatchFn).shift();
    }

    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text: string, filter?: Predicate<PhpSymbol>, fuzzy?: boolean) {

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
        let type = this.find(query.typeName, this._classOrInterfaceFilter);
        return this._lookupTypeMembers(type, query.memberPredicate, []);
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

    lookupMemberOnTypes(queries: MemberQuery[]) {
        return this.lookupMembersOnTypes(queries).shift();
    }

    /**
     * This will return duplicate symbols where members are overridden or already implemented
     * @param type 
     * @param predicate 
     * @param typeHistory 
     */
    private _lookupTypeMembers(type: PhpSymbol, predicate: Predicate<PhpSymbol>, typeHistory: string[]) {

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
        let baseMemberPredicate: Predicate<PhpSymbol> = (x) => {
            return predicate(x) && !(x.modifiers & SymbolModifier.Private);
        };
        let baseSymbol: PhpSymbol;
        let basePredicate: Predicate<PhpSymbol>;

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

    private _indexSymbols(root: PhpSymbol) {

        let traverser = new TreeTraverser([root]);
        return traverser.filter(this._indexFilter);

    }

    private _indexFilter(s: PhpSymbol) {
        return s.kind !== SymbolKind.Parameter &&
            (s.kind !== SymbolKind.Variable || !s.scope) && //script level vars
            !(s.modifiers & SymbolModifier.Use) &&
            s.name.length > 0;
    }



}

export const enum TypeSource {
    None,
    TypeDeclaration
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
                    //uneccessary? save a lookup and splice
                    //this._deleteNode(node);
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

        text = text.toLowerCase();
        let substrings: string[];

        if (fuzzy) {
            let trigrams = util.trigrams(text);
            trigrams.add(text);
            substrings = Array.from(trigrams);
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

        if (fuzzy) {
            return this._sortedFuzzyResults(text, matches);
        } else {
            return Array.from(new Set<PhpSymbol>(matches));
        }

    }

    private _sortedFuzzyResults(query: string, matches: PhpSymbol[]) {

        let map: { [index: string]: number } = {};
        let s: PhpSymbol;
        let name: string;
        let checkIndexOf = query.length > 3;
        let val: number;

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            name = s.name;
            if (map[name] === undefined) {
                val = 0;
                if (checkIndexOf) {
                    val = (PhpSymbol.notFqn(s.name).indexOf(query) + 1) * -10;
                    if (val < 0) {
                        val += 1000;
                    }
                }
                map[name] = val;
            }
            ++map[name];
        }

        let unique = Array.from(new Set(matches));

        let sortFn = (a: PhpSymbol, b: PhpSymbol) => {
            return map[b.name] - map[a.name];
        }

        unique.sort(sortFn);
        return unique;

    }

    private _nodeMatch(lcText: string) {

        let collator = this._collator;
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

        let notFqnPos = s.name.lastIndexOf('\\') + 1;
        let notFqn = s.name.slice(notFqnPos);
        let lcNotFqn = notFqn.toLowerCase();
        let lcFqn = s.name.toLowerCase();

        let keys = util.trigrams(lcNotFqn);
        if (lcNotFqn) {
            keys.add(lcNotFqn);
        }

        keys.add(lcFqn);

        let acronym = util.acronym(notFqn);
        if (acronym.length > 1) {
            keys.add(acronym);
        }
        return Array.from(keys);
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
                return new TypeString(this.nameResolver.namePhraseToFqn(<any>node, SymbolKind.Class));
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
            [PhraseType.QualifiedName, PhraseType.FullyQualifiedName, PhraseType.RelativeQualifiedName])) {
            return new TypeString(this.nameResolver.namePhraseToFqn(<any>node.type, SymbolKind.Class));
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

        let functionName = this.nameResolver.namePhraseToFqn(<any>qName, SymbolKind.Function)
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

        if (kind === SymbolKind.Property) {
            memberName = '$' + memberName;
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

        return type;
    }

}

export class VariableTypeResolver implements TreeVisitor<Phrase | Token>{

    private _varName: string;

    haltTraverse: boolean;

    constructor(public variableTable: VariableTable,
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public haltAtToken?: Token) {
        this.haltTraverse = false;
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

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
                    this._checkForHaltToken(<Phrase>node);
                    return false;
                }
                return true;
            case PhraseType.InstanceOfExpression:
                this._instanceOfExpression(<InstanceOfExpression>node);
                this._checkForHaltToken(<Phrase>node);
                return false;
            case PhraseType.ForeachStatement:
                this._foreachStatement(<ForeachStatement>node);
                return true;
            case PhraseType.CatchClause:
                this._catchClause(<CatchClause>node);
                return true;
            case undefined:
                this._token(<Token>node);
                return false;
            default:
                return true;
        }

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

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

    private _containsHaltNode(node: Phrase) {

        if (!this.haltAtNode) {
            return false;
        }

        if(node === this.haltAtNode){
            return true;
        }

        if(ParsedDocument.isToken(node)){
            return false;
        }

        let tFirst = this.document.firstToken(node);
        let tEnd = this.document.lastToken(node);
        let tHaltFirst = this.document.firstToken(this.haltAtNode);

        if(!tFirst || !tEnd || !tHaltFirst){
            return false;
        }

        if (tHaltFirst.offset >= tFirst.offset && tHaltFirst.offset <= tEnd.offset) {
            return true;
        }

    }

    private _checkForHaltToken(ancestor: Phrase) {
        if (!this.haltAtToken) {
            return;
        }

        let tFirst = this.document.firstToken(ancestor);
        let tEnd = this.document.lastToken(ancestor);
        if (this.haltAtToken.offset >= tFirst.offset && this.haltAtToken.offset <= tEnd.offset) {
            this.haltTraverse = true;
        }

    }

    private _qualifiedNameList(node: QualifiedNameList) {

        let fqns: string[] = [];

        for (let n = 0, l = node.elements.length; n < l; ++n) {
            fqns.push(this.nameResolver.namePhraseToFqn(node.elements[n], SymbolKind.Class));
        }

        return new TypeString(fqns.join('|'));
    }

    private _catchClause(node: CatchClause) {
        this.variableTable.setType(this.nameResolver.tokenText(node.variable), this._qualifiedNameList(node.nameList));
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

        if (this.haltAtToken === t) {
            this.haltTraverse = true;
            return;
        }

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
        let range = this.document.nodeRange(p);
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
        if (symbol && symbol.children) {

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
            ParsedDocument.isToken((<SimpleVariable>node).name, [TokenType.VariableName]);
    }

    private _assignmentExpression(node: BinaryExpression) {

        let lhs = node.left;
        let rhs = node.right;
        let exprTypeResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        let type: TypeString;

        if (ParsedDocument.isPhrase(lhs, [PhraseType.SimpleVariable])) {
            let varName = this._simpleVariable(<SimpleVariable>lhs);
            type = exprTypeResolver.resolveExpression(rhs);
            this.variableTable.setType(varName, type);
        } else if (ParsedDocument.isPhrase(node, [PhraseType.ListIntrinsic])) {
            let varNames = this._listIntrinsic(<ListIntrinsic>rhs);
            this.variableTable.setTypeMany(varNames, exprTypeResolver.resolveExpression(rhs).arrayDereference());
        }

    }

    private _foreachStatement(node: ForeachStatement) {

        let collection = node.collection;
        let value = node.value;

        let exprResolver = new ExpressionTypeResolver(this.nameResolver, this.symbolStore, this.variableTable);
        let type = exprResolver.resolveExpression(collection.expr).arrayDereference();

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

        return new TypeString('');

    }

    private _mergeSets(a: TypedVariableSet, b: TypedVariableSet) {

        let keys = Object.keys(b.variables);
        let typedVar: TypedVariable;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
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

function builtInSymbolTypeStrings(symbols: any[]) {
    let s: any;
    for (let n = 0, l = symbols.length; n < l; ++n) {
        s = symbols[n];
        if (s.type) {
            s.type = new TypeString(s.type);
        }

        if (s.children) {
            builtInSymbolTypeStrings(s.children);
        }
    }

}