/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {
    SymbolStore, PhpSymbol, SymbolKind, SymbolModifier,
    ExpressionTypeResolver, VariableTypeResolver, VariableTable
} from './symbol';
import {NameResolver} from './nameResolver';
import { TreeTraverser } from './types';
import {TypeString} from './typeString';
import { ParsedDocument } from './parsedDocument';
import {ParsedDocumentVisitor} from './parsedDocumentVisitor';
import { Position } from 'vscode-languageserver-types';
import {
    Phrase, Token, PhraseType, NamespaceDefinition, ClassDeclaration,
    TokenType
} from 'php7parser';

class ContextVisitor extends ParsedDocumentVisitor {

    private _spine: (Phrase | Token)[];

    constructor(
        public offset:number, 
        public nameResolver:NameResolver) {
        super(nameResolver)
    }

    get spine(){
        return this._spine.slice(0);
    }

    protected _preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return false;
        }

        if (ParsedDocument.isOffsetInToken(this.offset, <Token>node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            this._spine.push(node);
            return false;
        }

        return true;

    }

    protected _postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

    }


}

export class Context {

    private _parseTreeSpine: (Phrase | Token)[];
    private _offset: number;
    private _namespaceDefinition: NamespaceDefinition;
    private _scopePhrase: Phrase;
    private _scopeSymbol: PhpSymbol;
    private _variableTable: VariableTable;
    private _thisPhrase: ClassDeclaration;
    private _thisSymbol: PhpSymbol;
    private _thisBaseSymbol: PhpSymbol;
    private _namespaceName: string;

    constructor(
        public symbolStore:SymbolStore,
        public document: ParsedDocument, 
        public position: Position
    ) {

        this._offset = document.offsetAtPosition(position) - 1;
        let contextVisitor = new ContextVisitor(this._offset);
        document.traverse(contextVisitor);
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
        this._parseTreeSpine = contextVisitor.spine;

    }

    get word() {
        return this.document.wordAtOffset(this._offset);
    }

    get token() {
        return this._parseTreeSpine.length ? <Token>this._parseTreeSpine[this._parseTreeSpine.length - 1] : null;
    }

    get offset() {
        return this.document.offsetAtPosition(this.position);
    }

    get spine() {
        return this._parseTreeSpine.slice(0);
    }

    get thisName() {
        let s = this.thisSymbol;
        return s ? s.name : '';
    }

    get thisBaseName() {

        let s = this.thisBaseSymbol;
        return s ? s.name : '';

    }

    get namespaceName() {
        if (this._namespaceName === undefined) {
            if (this.namespacePhrase) {
                this._namespaceName = this.nodeText(this.namespacePhrase.name, [TokenType.Whitespace]);
            } else {
                this._namespaceName = '';
            }
        }
        return this._namespaceName;
    }

    get namespacePhrase() {
        if (this._namespaceDefinition === undefined) {
            let traverser = this.createTraverser();
            let nsDef = traverser.ancestor(this._isNamespaceDefinition);
            if (!nsDef) {
                traverser.up(traverser.depth() - 2);
                while (nsDef = traverser.prevSibling()) {
                    if (this._isNamespaceDefinition(nsDef)) {
                        break;
                    }
                }
            }

            this._namespaceDefinition = <NamespaceDefinition>nsDef;

        }
        return this._namespaceDefinition;
    }

    get thisPhrase() {

        if (this._thisPhrase === undefined) {
            let traverser = this.createTraverser();
            this._thisPhrase = traverser.ancestor(this._isClassDeclaration) as ClassDeclaration;
        }
        return this._thisPhrase;

    }

    get thisSymbol() {
        if (this._thisSymbol === undefined) {

            let phrase = this.thisPhrase;
            if (phrase) {
                let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
                let phrasePos = this.document.nodeRange(phrase).start;
                this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
            } else {
                this._thisSymbol = null;
            }

        }

        return this._thisSymbol;
    }

    get thisBaseSymbol() {

        if (this._thisBaseSymbol === undefined) {

            let thisSymbol = this.thisSymbol;
            if (!thisSymbol || !thisSymbol.associated) {
                this._thisBaseSymbol = null;
            } else {
                this._thisBaseSymbol = thisSymbol.associated.find((x) => {
                    return x.kind === SymbolKind.Class;
                });
            }

        }

        return this._thisBaseSymbol;
    }

    get scopePhrase() {

        if (!this._scopePhrase) {
            let t = this.createTraverser();
            //need to get scope body first to exclude chance 
            //that position is within a scope declaration
            t.ancestor(this._isScopeBody);
            this._scopePhrase = t.ancestor(this._isScopePhrase) as Phrase;
            if (!this._scopePhrase) {
                this._scopePhrase = this._parseTreeSpine[0] as Phrase;
            }
        }
        return this._scopePhrase;
    }

    get scopeSymbol() {

        if (!this._scopeSymbol) {

            let phrase = this.scopePhrase;
            let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
            let phrasePos = this.document.nodeRange(phrase).start;
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);

            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }

        }

        return this._scopeSymbol;

    }

    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = new VariableTypeResolver(
                new VariableTable(), this.document, this.createNameResolver(), this.symbolStore, this.token);
            let scope = this.scopePhrase;
            let traverser = new TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;

    }

    get symbolTable(){
        return this.symbolStore.getSymbolTable(this.document.uri);
    }

    textBefore(length:number){
        return this.document.textBeforeOffset(this._offset, length);
    }

    tokenText(t:Token){
        return this.document.tokenText(t);
    }

    nodeText(node: Phrase | Token, ignore?: TokenType[]) {
        return this.document.nodeText(node, ignore);
    }

    resolveFqn(phrase: Phrase, kind: SymbolKind) {
        let nameResolver = this.createNameResolver();
        return nameResolver.namePhraseToFqn(phrase, kind);
    }

    resolveExpressionType(expr: Phrase) {
        let exprResolver = this.createExpressionTypeResolver();
        return exprResolver.resolveExpression(expr);
    }

    createNameResolver() {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let imported = symbolTable ? symbolTable.filter(this._importFilter) : [];
        let namespaceName = this.namespaceName;
        let thisName = this.thisName;
        let baseName = this.thisBaseName;
        return new NameResolver(this.document, imported, namespaceName, thisName, baseName);
    }

    createTraverser() {
        return new TreeTraverser(this._parseTreeSpine);
    }

    createExpressionTypeResolver() {
        return new ExpressionTypeResolver(this.createNameResolver(), this.symbolStore, this.variableTable);
    }

    private _isScopePhrase(p: Phrase | Token) {
        switch ((<Phrase>p).phraseType) {
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
            case PhraseType.ClassDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                return true;
            default:
                return false;
        }
    }

    private _isScopeBody(p: Phrase | Token) {

        switch ((<Phrase>p).phraseType) {
            case PhraseType.FunctionDeclarationBody:
            case PhraseType.MethodDeclarationBody:
            case PhraseType.ClassMemberDeclarationList:
            case PhraseType.InterfaceMemberDeclarationList:
            case PhraseType.TraitMemberDeclarationList:
                return true;
            default:
                return false;
        }

    }

    private _importFilter(s: PhpSymbol) {
        return (s.modifiers & SymbolModifier.Use) > 0 &&
            (s.kind & (SymbolKind.Class | SymbolKind.Constant | SymbolKind.Function)) > 0;
    }

    private _isNamespaceDefinition(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.NamespaceDefinition;
    }

    private _isClassDeclaration(node: Phrase | Token) {
        return (<Phrase>node).phraseType === PhraseType.ClassDeclaration;
    }

}
