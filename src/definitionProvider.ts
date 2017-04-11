/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { SymbolStore, PhpSymbol } from './symbol';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import {Phrase, PhraseType} from 'php7parser';

export class DefintionProvider {

    constructor(public symbolStore: SymbolStore, public documentStore: ParsedDocumentStore) { }

    provideDefinition(uri: string, position: lsp.Position) {

        let doc = this.documentStore.find(uri);
        if(!doc){
            return null;
        }
        
        let context = new Context(this.symbolStore, doc, position);
        let traverser = context.createTraverser();
        let phrase:Phrase;
        let symbol:PhpSymbol;

        while(phrase = <Phrase>traverser.parent()){

            symbol = this._lookupSymbol(phrase, context);
            if(symbol){
                break;
            }

        }

        return symbol && symbol.location ? symbol.location : null;


    }

    private _lookupSymbol(phrase:Phrase, context:Context){

        switch(phrase.phraseType){
            case PhraseType.ObjectCreationExpression:

            case PhraseType.ScopedCallExpression:

            case PhraseType.ScopedPropertyAccessExpression:

            case PhraseType.ClassConstantAccessExpression:

            case PhraseType.ConstantAccessExpression:

            case PhraseType.MethodCallExpression:

            case PhraseType.PropertyAccessExpression:

            case PhraseType.FunctionCallExpression:

            
        }

    }

}