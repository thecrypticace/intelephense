/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TreeVisitor, MultiVisitor } from './types';
import { Phrase, Token, PhraseType, TokenType } from 'php7parser';
import { SymbolKind, PhpSymbol } from './symbol';
import { SymbolStore } from './symbolStore';
import { ParsedDocument } from './parsedDocument';
import {
    NodeTransform, QualifiedNameTransform, RelativeQualifiedNameTransform,
    FullyQualifiedNameTransform, DelimiteredListTransform
} from './transforms';
import { NameResolver } from './nameResolver';
import { Predicate, BinarySearch, BinarySearchResult } from './types';
import { NameResolverVisitor } from './nameResolverVisitor';
import { ParseTreeHelper } from './parseTreeHelper';
import * as lsp from 'vscode-languageserver-types';
import { isInRange } from './util';
import { TypeString } from './typeString';
import { TypeAggregate } from './typeAggregate';

export class ReferenceReader extends MultiVisitor<Phrase | Token> {

    constructor(
        public nameResolverVisitor: NameResolverVisitor,
        public variableTypeVisitor: VariableTypeVisitor,
        public referenceVisitor: ReferenceVisitor
    ) {
        super([
            nameResolverVisitor,
            variableTypeVisitor,
            referenceVisitor
        ]);
    }

    get references() {
        return this.referenceVisitor.references;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable) {
        return new ReferenceReader(
            new NameResolverVisitor(document, nameResolver),
            new VariableTypeVisitor(document, nameResolver, symbolStore, variableTable),
            new ReferenceVisitor(document, nameResolver, symbolStore)
        );
    }

}

export class ReferenceVisitor implements TreeVisitor<Phrase | Token> {

    private _references: Reference[];
    private _transformerStack: NodeTransform[];
    private _variableTable: VariableTable;

    constructor(
        public doc: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore
    ) {
        this._references = [];
        this._transformerStack = [];
        this._variableTable = new VariableTable();
    }

    get references() {
        return new DocumentReferences(this.doc.uri, this._references);
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
                this._variableTable.pushScope();
                return true;
            case PhraseType.AnonymousFunctionCreationExpression:
                this._anonymousFunctionCreationExpression(node);
                return true;
            case PhraseType.IfStatement:
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseIfClause:
                this._variableTable.pushBranch();
                return true;
            case PhraseType.ElseClause:
                let elseClauseParent = spine[spine.length - 1];
                if (!(<IfStatement>elseClauseParent).elseIfClauseList) {
                    this._variableTable.popBranch();
                }
                this._variableTable.pushBranch();
                return true;
            case PhraseType.ElseIfClauseList:
                this._variableTable.popBranch(); //pop the if branch
                return true;
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                if (ParsedDocument.isPhrase((<BinaryExpression>node).left, [PhraseType.SimpleVariable, PhraseType.ListIntrinsic])) {
                    this._assignmentExpression(<BinaryExpression>node);
                    if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                        this.haltTraverse = true;
                    }
                    return false;
                }
                return true;
            case PhraseType.InstanceOfExpression:
                this._instanceOfExpression(<InstanceOfExpression>node);
                if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                    this.haltTraverse = true;
                }
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
                    this._variableTable.popBranch();
                }
                this._variableTable.pruneBranches();
                break;
            case PhraseType.SwitchStatement:
                this._variableTable.pruneBranches();
                break;
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseClause:
            case PhraseType.ElseIfClause:
                this._variableTable.popBranch();
                break;
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this._variableTable.popScope();
                break;
            default:
                break;
        }

    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FullyQualifiedName:
                this._transformerStack.push(
                    new FullyQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.RelativeQualifiedName:
                this._transformerStack.push(
                    new RelativeQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.QualifiedName:
                this._transformerStack.push(
                    new QualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.NamespaceName:
                this._transformerStack.push(null);
                return false;

            case undefined:
                //tokens
                return false;

            default:
                this._transformerStack.push(null);
                return true;
        }

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;
        let transformer = (<Phrase>node).phraseType ? this._transformerStack.pop() : null;
        let parentTransformer = this._transformerStack.length ? this._transformerStack[this._transformerStack.length - 1] : null;
        let transform: any;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.FullyQualifiedName:
                if ((transform = transformer.value() as Reference)) {
                    this._references.push(transform);
                }

                if (parentTransformer) {
                    parentTransformer.push(transform, node);
                }
                break;

            case PhraseType.NamespaceName:
                if (parentTransformer) {
                    parentTransformer.push(this.doc.nodeText(node), node);
                }
                break;

            default:

                break;

        }


    }



}

class MemberNameTransform implements NodeTransform {

    phraseType = PhraseType.MemberName;
    value: Reference;

    constructor(position: lsp.Position) {
        this.value = Reference.create(PhpSymbol.create(SymbolKind.Method | SymbolKind.Property, ''), position, 0);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value.identifier.name = transform.value;
            this.value.length = this.value.identifier.name.length;
        }
    }

}

class ScopedMemberNameTransform implements NodeTransform {

    phraseType = PhraseType.ScopedMemberName;
    value: Reference;

    constructor(position: lsp.Position) {
        this.value = Reference.create(PhpSymbol.create(SymbolKind.Method | SymbolKind.Property | SymbolKind.ClassConstant, ''), position, 0);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.VariableName || transform.phraseType === PhraseType.Identifier) {
            this.value.identifier.name = transform.value;
            this.value.length = this.value.identifier.name.length;
        }
    }

}

class ScopedExpressionTransform implements NodeTransform {

    phraseType = PhraseType.ScopedCallExpression;
    value: Reference;
    private _symbolKind: SymbolKind;

    constructor(symbolKind: SymbolKind) {
        this._symbolKind = symbolKind;
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.ScopedMemberName) {
            this.value = transform.value;
            this.value.identifier.kind = this._symbolKind;
        } else if (
            transform.tokenType !== TokenType.ColonColon &&
            transform.tokenType !== TokenType.Whitespace &&
            transform.tokenType !== TokenType.Comment &&
            transform.tokenType !== TokenType.DocumentComment &&
            transform.phraseType !== PhraseType.ArgumentExpressionList
        ) {
            let ref = transform.value as Reference;
            if (ref && ref.identifier && ref.identifier.name) {

            }
        }
    }

}



export interface Reference {
    kind: SymbolKind;
    name: string;
    position: lsp.Position;
    type?: string;
    altName?: string;
    scope?: string;
}

export namespace Reference {
    export function create(identifier: PhpSymbol, position: lsp.Position, length: number) {
        return {
            identifier: identifier,
            position: position,
            length: length
        };
    }

    export function toTypeString(ref: Reference, symbolStore: SymbolStore) {

        if (!ref) {
            return '';
        }

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                return ref.name;

            case SymbolKind.Function:


            case SymbolKind.Method:

            case SymbolKind.Property:


            case SymbolKind.Variable:
                return ref.type || '';

            default:
                return '';


        }
    }

    export function findSymbols(ref: Reference, symbolStore: SymbolStore) {

        if (!ref) {
            return null;
        }

        let symbols: PhpSymbol[];
        let fn: Predicate<PhpSymbol>;

        switch (ref.kind) {
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Trait:
                fn = (x) => {
                    return x.kind === ref.kind;
                };
                symbols = symbolStore.find(ref.name, fn);
                break;

            case SymbolKind.Function:
            case SymbolKind.Constant:
                fn = (x) => {
                    return x.kind === ref.kind;
                };
                symbols = symbolStore.find(ref.name, fn);
                if (symbols.length < 1 && ref.altName) {
                    symbols = symbolStore.find(ref.altName, fn);
                }
                break;

            case SymbolKind.Method:
                fn = (x) => {
                    return x.kind === SymbolKind.Method && x.name.toLowerCase() === ref.name.toLowerCase();
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Property:
                fn = (x) => {
                    return x.kind === SymbolKind.Property && x.name.slice(1) === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.ClassConstant:
                fn = (x) => {
                    return x.kind === SymbolKind.ClassConstant && x.name === ref.name;
                };
                symbols = findMembers(symbolStore, ref.scope, fn);
                break;

            case SymbolKind.Variable:

                break;

            default:
                break;

        }

        return symbols;

    }

    function findMembers(symbolStore: SymbolStore, scope: string, predicate: Predicate<PhpSymbol>) {

        let fqnArray = TypeString.atomicClassArray(scope);
        let type: TypeAggregate;
        let members = new Set<PhpSymbol>();
        for (let n = 0; n < fqnArray.length; ++n) {
            type = TypeAggregate.create(symbolStore, fqnArray[n]);
            if (type) {
                Set.prototype.add.apply(members, type.members(predicate));
            }
        }
        return Array.from(members);
    }

}

export class DocumentReferences {

    private _references: Reference[];
    private _uri: string;
    private _search: BinarySearch<Reference>;

    constructor(uri: string, references: Reference[]) {
        this._uri = uri;
        this._references = references;
        this._search = new BinarySearch(this._references);
    }

    filter(predicate: Predicate<Reference>) {
        let matches: Reference[] = [];
        let ref: Reference;
        for (let n = 0, l = this._references.length; n < l; ++n) {
            ref = this._references[n];
            if (predicate(ref)) {
                matches.push(ref);
            }
        }
        return matches;
    }

    referenceAtPosition(position: lsp.Position) {

        let fn = (x: Reference) => {
            return isInRange(position, x.range.start, x.range.end);
        }

        return this._search.find(fn);

    }

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

    setType(varName: string, type: string) {
        if (!varName || !type) {
            return;
        }
        this._top().variables[varName] = { name: varName, type: type };
    }

    setTypeMany(varNames: string[], type: string) {
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
            let type: string;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
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

    getType(varName: string, className?: string) {

        if (varName === '$this' && className) {
            return className;
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

        return '';

    }

    private _mergeSets(a: TypedVariableSet, b: TypedVariableSet) {

        let keys = Object.keys(b.variables);
        let typedVar: TypedVariable;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = TypeString.merge(a.variables[typedVar.name].type, typedVar.type);
            } else {
                a.variables[typedVar.name] = typedVar;
            }
        }

    }

    private _top() {
        return this._typeVariableSetStack[this._typeVariableSetStack.length - 1];
    }

}

interface TypedVariable {
    name: string;
    type: string;
}

const enum TypedVariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface TypedVariableSet {
    kind: TypedVariableSetKind;
    variables: { [index: string]: TypedVariable };
    branches: TypedVariableSet[];
}