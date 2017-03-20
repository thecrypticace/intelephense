/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Location, Predicate, TreeTraverser, TreeVisitor, BinarySearch, SuffixArray } from './types';
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
    TraitUseClause, SimpleVariable
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
    range?: Range;
    modifiers?: SymbolModifier;
    description?: string;
    type?: TypeString;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    parent?: PhpSymbol;

}

export interface ImportRule {
    kind: SymbolKind;
    alias: string;
    fqn: string;
}

export class ImportTable {

    private _rules: ImportRule[];
    private _uri: string;

    constructor(uri: string, importRules: ImportRule[] = []) {
        this._uri = uri;
        this._rules = importRules;
    }

    get uri() {
        return this._uri;
    }

    addRule(rule: ImportRule) {
        this._rules.push(rule);
    }

    addRuleMany(rules: ImportRule[]) {
        Array.prototype.push.apply(this._rules, rules);
    }

    match(text: string, kind: SymbolKind) {
        let r: ImportRule;
        let name: string;
        for (let n = 0; n < this._rules.length; ++n) {
            r = this._rules[n];
            name = r.alias ? r.alias : this._lastNamespaceNamePart(r.fqn);
            if (r.kind === kind && text === name) {
                return r;
            }
        }
        return null;
    }

    private _lastNamespaceNamePart(text: string) {
        let pos = text.lastIndexOf('\\');
        return pos >= 0 ? text.slice(pos + 1) : text;
    }

}

export class NameResolver {

    namespace: string;
    thisName: string;

    constructor(
        public importTable: ImportTable) {
        this.namespace = '';
        this.thisName = '';
    }

    resolveRelative(relativeName: string) {
        if (!relativeName) {
            return '';
        }
        return this.namespace ? this.namespace + '\\' + relativeName : relativeName;
    }

    resolveNotFullyQualified(notFqName: string, kind: SymbolKind) {

        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }

        let pos = notFqName.indexOf('\\');
        if (pos < 0) {
            return this._resolveUnqualified(notFqName, kind);
        } else {
            this._resolveQualified(name, pos, kind);
        }
    }

    private _resolveQualified(name: string, pos: number, kind: SymbolKind) {

        let rule = this.importTable.match(name.slice(0, pos), kind);
        if (rule) {
            return rule.fqn + name.slice(pos);
        } else {
            return this.resolveRelative(name);
        }

    }

    private _resolveUnqualified(name: string, kind: SymbolKind) {

        let rule = this.importTable.match(name, kind);
        if (rule) {
            return rule.fqn;
        } else {
            return this.resolveRelative(name);
        }

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
        public importTable: ImportTable,
        public root: PhpSymbol) {

    }

    static fromParseTree(parseTree: ParseTree, textDocument: TextDocument) {

        let symbolReader = new SymbolReader(
            textDocument,
            new NameResolver(new ImportTable(textDocument.uri)),
            [{ kind: SymbolKind.None, name: null, children: [] }]
        );

        let traverser = new TreeTraverser<Phrase | Token>([parseTree.root]);
        traverser.traverse(symbol)


    }

}

/**
 * Get suffixes after $, namespace separator, underscore and on capitals
 * Includes acronym using non namespaced portion of string
 */
function symbolSuffixes(symbol: PhpSymbol) {

    let text = symbol.toString();
    let lcText = text.toLowerCase();
    let suffixes = [lcText];
    let n = 0;
    let c: string;
    let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';

    while (n < text.length) {

        c = text[n];

        if (c === '\\') {
            acronym = '';
        }

        if ((c === '$' || c === '\\' || c === '_') && n + 1 < text.length && text[n + 1] !== '_') {
            ++n;
            suffixes.push(lcText.slice(n));
            acronym += lcText[n];
        } else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
            //uppercase
            suffixes.push(lcText.slice(n));
            acronym += lcText[n];
        }

        ++n;

    }

    if (acronym.length > 1) {
        suffixes.push(acronym);
    }

    return suffixes;
}

export class SymbolStore {

    private _map: { [index: string]: SymbolTable };
    private _index: SuffixArray<PhpSymbol>;

    constructor() {
        this._map = {};
        this._index = new SuffixArray<PhpSymbol>(symbolSuffixes);
    }

    getDocumentSymbols(uri: string) {
        return this._map[uri];
    }

    add(documentSymbols: SymbolTable) {
        if (this.getDocumentSymbols(documentSymbols.uri)) {
            throw new Error(`Duplicate key ${documentSymbols.uri}`);
        }
        this._map[documentSymbols.uri] = documentSymbols;
        this._index.addMany(this._indexSymbols(documentSymbols.symbolTree));
    }

    remove(uri: string) {
        let doc = this.getDocumentSymbols(uri);
        if (!doc) {
            return;
        }
        this._index.removeMany(this._indexSymbols(doc.symbolTree));
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

        let filtered: Tree<PhpSymbol>[] = [];
        let s: Tree<PhpSymbol>;

        for (let n = 0; n < matched.length; ++n) {
            s = matched[n];
            if ((s.value.kind & kindMask) > 0) {
                filtered.push(s);
            }
        }

        return filtered;
    }

    lookupTypeMembers(typeName: string, predicate: Predicate<Tree<PhpSymbol>>) {
        let type = this.match(typeName, SymbolKind.Class | SymbolKind.Interface).shift();
        return this._lookupTypeMembers(type, predicate);
    }

    lookupTypeMember(typeName: string, predicate: Predicate<Tree<PhpSymbol>>) {
        return this.lookupTypeMembers(typeName, predicate).shift();
    }

    private _lookupTypeMembers(type: Tree<PhpSymbol>, predicate: Predicate<Tree<PhpSymbol>>) {

        if (!type) {
            return [];
        }

        let members = type.children.filter(predicate);
        let memberNames = members.map((x) => {
            return x.value.name;
        });

        let associatedNames: string[] = [];

        if (type.value.extends) {
            Array.prototype.push.apply(associatedNames, type.value.extends);
        }

        if (type.value.traits) {
            Array.prototype.push.apply(associatedNames, type.value.traits);
        }

        //lookup in base class/traits
        let associated: Tree<PhpSymbol>;
        let baseKindMask = type.value.kind === SymbolKind.Class ? SymbolKind.Class | SymbolKind.Trait : SymbolKind.Interface;
        let basePredicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return predicate(x) && !(x.value.modifiers & SymbolModifier.Private) && memberNames.indexOf(x.value.name) < 0;
        };

        for (let n = 0; n < associatedNames.length; ++n) {
            associated = this.match(associatedNames[n], baseKindMask).shift();
            if (associated) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(associated, basePredicate));
            }

        }

        return members;
    }

    private _indexSymbols(symbolTree: Tree<PhpSymbol>) {

        let notKindMask = SymbolKind.Parameter | SymbolKind.Variable;

        let predicate: Predicate<Tree<PhpSymbol>> = (x) => {
            return x.value && !(x.value.kind & notKindMask);
        };

        return symbolTree.match(predicate);

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
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string;
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;

    constructor(
        public textDocument: TextDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) {

    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let s: PhpSymbol;

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                s = SymbolReader.namespaceDefinition(<NamespaceDefinition>node);
                this.nameResolver.namespace = s.name;
                this._popNamespace();
                this._addSymbol(s, true);
                return true;

            case PhraseType.NamespaceUseDeclaration:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    SymbolReader.namespaceUseDeclaration(<NamespaceUseDeclaration>node);
                return true;

            case PhraseType.NamespaceUseClause:
                this.nameResolver.importTable.addRule(
                    SymbolReader.namespaceUseClause(<NamespaceUseClause>node,
                        this.namespaceUseDeclarationKind,
                        this.namespaceUseDeclarationPrefix
                    ));
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
                    SymbolReader.classDeclaration(<ClassDeclaration>node, this.lastPhpDoc),
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
                    SymbolReader.interfaceDeclaration(<InterfaceDeclaration>node, this.lastPhpDoc),
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
                    SymbolReader.traitDeclaration(<TraitDeclaration>node, this.lastPhpDoc),
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

    private _variableExists(name: string) {
        let s = this.spine[this.spine.length - 1];

        if (!s.children) {
            return false;
        }

        let mask = SymbolKind.Parameter | SymbolKind.Variable;

        for (let n = 0, l = s.children.length; n < l; ++n) {
            if ((s.children[n].kind & mask) > 0 && s.name === name) {
                return true;
            }
        }

        return false;
    }

    private _popNamespace() {
        if (this.spine[this.spine.length - 1].kind === SymbolKind.Namespace) {
            this.spine.pop();
        }
    }

    private _token(t: Token) {

        switch (t.tokenType) {
            case TokenType.DocumentComment:
                this.lastPhpDoc = PhpDocParser.parse(SymbolReader.tokenText(t));
                break;
            case TokenType.CloseBrace:
                this.lastPhpDoc = null;
                break;
            default:
                break;
        }
    }

    private _addSymbol(symbol: PhpSymbol, pushToSpine: boolean) {

        if (!symbol) {
            return;
        }

        symbol.parent = this.spine[this.spine.length - 1];
        if (!symbol.parent.children) {
            symbol.parent.children = [];
        }
        symbol.parent.children.push(symbol);

        if (pushToSpine) {
            this.spine.push(symbol);
        }

    }

}


export namespace SymbolReader {

    export var nameResolver: NameResolver;
    export var textDocument: TextDocument;

    export function tokenText(t: Token) {
        return t ? textDocument.textAtOffset(t.offset, t.length) : null;
    }

    export function nameTokenToFqn(t: Token) {
        let name = tokenText(t);
        return name ? nameResolver.resolveRelative(name) : null;
    }

    export function phraseRange(p: Phrase) {
        if (!p) {
            return null;
        }

        let startToken: Token, endToken: Token;
        [startToken, endToken] = ParseTree.tokenRange(p);

        if (!startToken || !endToken) {
            return null;
        }

        return <Range>{
            start: textDocument.positionAtOffset(startToken.offset),
            end: textDocument.positionAtOffset(endToken.offset + endToken.length)
        }
    }

    export function tagTypeToFqn(type: string) {
        if (!type) {
            return null;
        } else if (type[0] === '\\') {
            return type.slice(1);
        } else {
            return nameResolver.resolveRelative(type);
        }
    }

    /**
     * 
     * Uses phrase range to provide "unique" name
     */
    export function anonymousName(node: Phrase) {
        let range = phraseRange(node);
        let suffix = [range.start.line, range.end.line, range.end.line, range.end.character].join('.');
        return '.anonymous.' + suffix;
    }

    export function functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(tagTypeToFqn(returnTag.typeString));
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
            name: tokenText(node.name),
            range: phraseRange(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = tagTypeToFqn(tag.typeString);
                s.type = s.type ? s.type.merge(type) : new TypeString(type);
            }
        }

        return s;
    }

    export function typeDeclaration(node: TypeDeclaration) {

        return (<Phrase>node.name).phraseType ?
            qualifiedName(<QualifiedName>node.name, SymbolKind.Class) :
            tokenText(<Token>node.name);

    }

    export function qualifiedName(node: QualifiedName, kind: SymbolKind) {
        if (!node || !node.name) {
            return null;
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
            range: phraseRange(node)
        };

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
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
            range: phraseRange(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
            }
        }

        return s;

    }

    export function methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(tagTypeToFqn(returnTag.typeString));
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
            name: tokenText(node.name),
            modifiers: modifiers,
            range: phraseRange(node)
        }

        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tagTypeToFqn(tag.typeString));
            }
        }

        return s;

    }

    export function identifier(node: Identifier) {
        return tokenText(node.name);
    }

    export function interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Interface,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
        }

        return s;

    }

    export function phpDocMembers(phpDoc: PhpDoc) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n]));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n]));
        }

        return symbols;
    }

    export function methodTagToSymbol(tag: Tag) {
        let s: PhpSymbol = {
            kind: SymbolKind.Method,
            modifiers: SymbolModifier.Magic,
            name: tag.name,
            type: new TypeString(tagTypeToFqn(tag.typeString)),
            description: tag.description,
            children: []
        };

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n]));
        }

        return s;
    }

    export function magicMethodParameterToSymbol(p: MethodTagParam) {

        return <PhpSymbol>{
            kind: SymbolKind.Parameter,
            name: p.name,
            modifiers: SymbolModifier.Magic,
            type: new TypeString(tagTypeToFqn(p.typeString))
        }

    }

    export function propertyTagToSymbol(t: Tag) {
        return <PhpSymbol>{
            kind: SymbolKind.Property,
            name: t.name,
            modifiers: magicPropertyModifier(t) | SymbolModifier.Magic,
            type: new TypeString(tagTypeToFqn(t.typeString)),
            description: t.description
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

    export function traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc) {
        let s: PhpSymbol = {
            kind: SymbolKind.Trait,
            name: null,
            range: phraseRange(node),
            children: []
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
        }

        return s;
    }

    export function traitDeclarationHeader(node: TraitDeclarationHeader) {
        return nameTokenToFqn(node.name);
    }

    export function classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc) {

        let s: PhpSymbol = {
            kind: SymbolKind.Class,
            name: null,
            range: phraseRange(node),
            children: []
        };

        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, phpDocMembers(phpDoc));
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
            range: phraseRange(node)
        };
    }

    export function anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression) {

        return <PhpSymbol>{
            kind: SymbolKind.Function,
            name: anonymousName(node),
            modifiers: SymbolModifier.Anonymous,
            range: phraseRange(node)
        };

    }

    export function anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable) {
        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: tokenText(node.name)
        };
    }

    export function simpleVariable(node: SimpleVariable) {
        if (!node.name || (<Token>node.name).tokenType !== TokenType.VariableName) {
            return null;
        }

        return <PhpSymbol>{
            kind: SymbolKind.Variable,
            name: tokenText(<Token>node.name)
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
            parts.push(tokenText(node.parts[n]));
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

        return <ImportRule>{
            kind: kind ? kind : SymbolKind.Class,
            fqn: concatNamespaceName(prefix, namespaceName(node.name)),
            alias: node.aliasingClause ? tokenText(node.aliasingClause.alias) : null
        };

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
            range: phraseRange(node),
            children: []
        };

    }

}
