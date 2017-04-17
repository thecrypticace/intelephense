import {TypeString, NameResolver} from '../src/symbol';
import {ParsedDocument} from '../src/parsedDocument';
import { assert } from 'chai';
import 'mocha';

let doc = new ParsedDocument('test', '<?php ');

describe('TypeString', function(){

    describe('#nameResolve', function(){

        it('Should not resolve keywords and built in types', function(){
            let resolver = new NameResolver(doc, [], 'Foo\\Bar', '', '');
            let ts = new TypeString('int|string|array|null|mixed|float');
            assert.equal(ts.nameResolve(resolver).toString(), 'int|string|array|null|mixed|float');
        });
        
        it('Should resolve non keywords/built-ins', function(){
            let resolver = new NameResolver(doc, [], 'Foo\\Bar', '', '');
            let ts = new TypeString('Baz');
            assert.equal(ts.nameResolve(resolver).toString(), 'Foo\\Bar\\Baz');
        });

        it('Should remove leading backslash from fqn', function(){
            let resolver = new NameResolver(doc, [], 'Foo\\Bar', '', '');
            let ts = new TypeString('\\Baz');
            assert.equal(ts.nameResolve(resolver).toString(), 'Baz');
        });

    });

});