/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import {Location, Position} from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import {SymbolStore} from './symbolStore';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { ParseTreeTraverser } from './parseTreeTraverser';
import { TypeString } from './typeString';
import { Phrase, PhraseType, Token, TokenType } from 'php7parser';
import { TreeTraverser } from './types';
import {MemberMergeStrategy} from './typeAggregate';

export class DefinitionProvider {

    constructor(public symbolStore: SymbolStore, public documentStore: ParsedDocumentStore) { }

    provideDefinition(uri: string, position: Position) {

        let doc = this.documentStore.find(uri);
        let table = this.symbolStore.getSymbolTable(uri);
        
        if (!doc || !table) {
            return null;
        }

        let traverser = new ParseTreeTraverser(doc, table);
        traverser.position(position);
        let ref = traverser.reference;
        
        if(!ref) {
            return null;
        }

        let symbols = this.symbolStore.findSymbolsByReference(ref, MemberMergeStrategy.Override);
        let locations:Location[] = [];
        let s:PhpSymbol;
        let loc:Location;

        for(let n = 0; n < symbols.length; ++n) {
            s = symbols[n];
            if(s.location && (loc = this.symbolStore.identifierLocation(s))) {
                locations.push(loc);
            }
        }

        return locations.length === 1 ? locations[0] : locations;

    }

    /*
    private _lookupSymbol(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let phrase = traverser.node as Phrase;
        switch (phrase.phraseType) {
            case PhraseType.SimpleVariable:
                return this._simpleVariable(traverser, context);
            case PhraseType.ScopedMemberName:
                return this._scopedMemberName(traverser, context);
            case PhraseType.MemberName:
                return this._memberName(traverser, context);
            case PhraseType.NamespaceName:
                return this._namespaceName(traverser, context);
            default:
                return null;

        }

    }

    private _isConstFuncClassTraitInterface(s: PhpSymbol) {

        switch (s.kind) {
            case SymbolKind.Class:
            case SymbolKind.Trait:
            case SymbolKind.Interface:
            case SymbolKind.Constant:
            case SymbolKind.Function:
                return s.location !== undefined && s.location !== null;
            default:
                return false;
        }

    }

    private _namespaceName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let t2 = traverser.clone();
        if (this._isNamePhrase(t2.parent())) {
            return this._qualifiedName(t2, context);
        }

        //probably namespace use decl
        return this.symbolStore.find(context.nodeText(traverser.node, [TokenType.Whitespace]), this._isConstFuncClassTraitInterface);


    }

    private _qualifiedName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let kind = SymbolKind.Class;
        let phrase = traverser.node as Phrase
        let parent = traverser.parent();

        if (ParsedDocument.isPhrase(parent, [PhraseType.ConstantAccessExpression])) {
            kind = SymbolKind.Constant;
        } else if (ParsedDocument.isPhrase(parent, [PhraseType.FunctionCallExpression])) {
            kind = SymbolKind.Function;
        }

        let name = context.resolveFqn(phrase, kind);
        return this.symbolStore.find(name, this._isConstFuncClassTraitInterface);

    }

    private _scopedMemberName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let memberNamePhrase = traverser.node as ScopedMemberName;
        if (!ParsedDocument.isPhrase(memberNamePhrase.name, [PhraseType.Identifier]) &&
            !ParsedDocument.isToken(memberNamePhrase.name, [TokenType.VariableName])) {
            return null;
        }
        let parent = traverser.parent() as ScopedExpression;
        let memberName = context.nodeText(memberNamePhrase.name);
        let typeNames = TypeString.atomicClassArray(context.resolveExpressionType(<Phrase>parent.scope));
        let pred = (x: PhpSymbol) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map<MemberQuery>((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);

    }

    private _memberName(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let memberNamePhrase = traverser.node as MemberName;
        if (!ParsedDocument.isToken(memberNamePhrase.name, [TokenType.Name])) {
            return null;
        }
        let parent = traverser.parent() as ObjectAccessExpression;
        let memberName = context.tokenText(<Token>memberNamePhrase.name);
        let typeNames = TypeString.atomicClassArray(context.resolveExpressionType(<Phrase>parent.variable));

        if(parent.phraseType === PhraseType.PropertyAccessExpression){
            memberName = '$' + memberName;
        }

        let pred = (x: PhpSymbol) => {
            return memberName === x.name && !!x.location;
        };
        let queries = typeNames.map<MemberQuery>((x) => {
            return { typeName: x, memberPredicate: pred };
        });
        return this.symbolStore.lookupMemberOnTypes(queries);

    }

    private _simpleVariable(traverser: TreeTraverser<Phrase | Token>, context: Context) {

        let phrase = traverser.node as SimpleVariable;
        if (!ParsedDocument.isToken(phrase.name, [TokenType.VariableName])) {
            return null;
        }

        let varName = context.tokenText(<Token>phrase.name);
        let scopeSymbol = context.scopeSymbol;
        let pred = (x: PhpSymbol) => {
            return x.name === varName;
        };
        return scopeSymbol.children.find(pred);

    }

    private _isNamePhrase(node: Phrase | Token) {

        if (!node) {
            return false;
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
                return true;
            default:
                return false;
        }

    }
 */
}