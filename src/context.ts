/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import {
    SymbolStore, NameResolver, PhpSymbol, SymbolKind, SymbolModifier,
    ExpressionTypeResolver, VariableTypeResolver, VariableTable
} from './symbol';
import { TreeVisitor, TreeTraverser } from './types';
import { ParsedDocument } from './parsedDocument';
import { Position } from 'vscode-languageserver-types';
import { Phrase, Token, PhraseType, NamespaceDefinition, ClassDeclaration } from 'php7parser';

class ContextVisitor implements TreeVisitor<Phrase | Token>{

    haltTraverse: boolean;

    private _spine: (Phrase | Token)[];
    private _namespaceDefinition: NamespaceDefinition;

    constructor(public offset) {
        this.haltTraverse = false;
    }

    get spine() {
        return this._spine;
    }

    get namespaceDefinition() {
        return this._namespaceDefinition;
    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return false;
        }

        if (ParsedDocument.isOffsetInToken(this.offset, <Token>node)) {
            this.haltTraverse = true;
            this._spine = spine.slice(0);
            this._spine.push(node);
            return false;
        }

        if ((<Phrase>node).phraseType === PhraseType.NamespaceDefinition) {
            this._namespaceDefinition = <NamespaceDefinition>node;
        }

        return true;

    }

    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if (this.haltTraverse) {
            return;
        }

        if ((<Phrase>node).phraseType === PhraseType.NamespaceDefinition &&
            (<NamespaceDefinition>node).statementList) {
            this._namespaceDefinition = undefined;
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

    constructor(public symbolStore: SymbolStore, public document: ParsedDocument, public position: Position) {

        this._offset = document.offsetAtPosition(position);
        let contextVisitor = new ContextVisitor(this._offset);
        document.traverse(contextVisitor);
        this._namespaceDefinition = contextVisitor.namespaceDefinition;
        this._parseTreeSpine = contextVisitor.spine;



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
            let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
            let phrasePos = this.document.phraseRange(phrase).start;
            this._thisSymbol = symbolTable.symbolAtPosition(phrasePos);
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
            let phrasePos = this.document.phraseRange(phrase).start;
            this._scopeSymbol = symbolTable.symbolAtPosition(phrasePos);

            if (!this._scopeSymbol) {
                this._scopeSymbol = symbolTable.root;
            }

        }

        return this._scopeSymbol;

    }

    get variableTable() {
        if (!this._variableTable) {
            let varTypeResolver = new VariableTypeResolver(new VariableTable(), this.document, this.createNameResolver(), this.symbolStore, this.token);
            let scope = this.scopePhrase;
            let traverser = new TreeTraverser([scope]);
            traverser.traverse(varTypeResolver);
            this._variableTable = varTypeResolver.variableTable;
        }
        return this._variableTable;

    }

    createNameResolver() {
        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let imported = symbolTable ? symbolTable.filter(this._importFilter) : [];
        let namespaceName = this._namespaceDefinition ?
            this.document.namespaceNameToString(this._namespaceDefinition.name) : '';
        let thisName = '';
        let baseName = '';
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
            case PhraseType.CompoundStatement:
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

    /*

    private _tokenIndex: number;
    private _token: Token;
    private _phraseNode: Tree<Phrase | Token>;
    private _scopeNode: Tree<Phrase | Token>;
    private _concreteScopeNode: Tree<Phrase | Token>;
    private _thisNode: Tree<Phrase | Token>;
    private _namespaceNode: Tree<Phrase | Token>;

    constructor(public position: Position,
        public parsedDoc: ParsedDocument,
        public symbolStore: SymbolStore) {
        let visitor = new AstContextVisitor(this.position);
        this.parsedDoc.parseTree.traverse(visitor);
        this._phraseNode = visitor.phraseNode;
        this._scopeNode = visitor.scopeNode;
        this._namespaceNode = visitor.namespaceNode;
        this._thisNode = visitor.thisNode;
        this._concreteScopeNode = visitor.concreteScopeNode;
    }

    get token() {
        return this.parsedDoc.tokens[this.tokenIndex];
    }

    get phraseNode() {
        return this._phraseNode;
    }

    get scopeNode() {
        return this._scopeNode;
    }

    get concreteScopeNode() {
        return this._concreteScopeNode;
    }

    get tokenIndex() {
        if (this._tokenIndex === undefined) {
            this._tokenIndex = this.parsedDoc.tokenIndexAtPosition(this.position);
        }
        return this._tokenIndex;
    }

    get namespaceNode() {
        return this._namespaceNode;
    }

    get thisNode() {
        return this._thisNode;
    }

    get namespaceName() {
        return this._namespaceNode ? namespaceNodeToString(this._namespaceNode) : '';
    }

    get thisName() {
        if (!this._thisNode) {
            return '';
        }

        let thisName: string
        if ((<Phrase>this._thisNode.value).phraseType === PhraseType.AnonymousClassDeclaration) {
            thisName = anonymousName(this._thisNode);
        } else {
            thisName = tokenNodeToString(this._thisNode.children[0]);
            let nsName = this.namespaceName;
            if (thisName && nsName) {
                thisName = nsName + '\\' + thisName;
            }
        }

        return thisName;

    }

    get thisExtendsName() {
        let thisNode = this.thisNode;
        if(!thisNode || (<Phrase>thisNode.value).phraseType !== PhraseType.ClassDeclaration){
            return '';
        }

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        return nameNodeToFqnString(thisNode.children[2], nameResolver, SymbolKind.Class);

    }

    typeResolveExpression(node: Tree<Phrase | Token>) {

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        nameResolver.thisName = this.thisName;
        let exprTypeResolver = new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable);
        node.traverse(exprTypeResolver);
        return exprTypeResolver.type;

    }

    typeResolveVariable = (varNode: Tree<Phrase|Token>) => {

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        nameResolver.thisName = this.thisName;
        let varName = variableNodeToString(varNode);
        
        if (!varName) {
            return null;
        } else if (varName === '$this') {
            return new TypeString(nameResolver.thisName);
        } else {

            let varTable = new VariableTable();
            if (nameResolver.thisName) {
                varTable.pushThisType(new TypeString(nameResolver.thisName));
            }
            let varTypeResolver = new VariableTypeResolver(varTable, nameResolver,
                this.symbolStore, new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable),
                varNode, varName);

            this._concreteScopeNode.traverse(varTypeResolver);
            return varTypeResolver.variableTable.getType(varName);

        }

    }

}
*/