import { PhpDoc, Tag, MethodTagParam, PhpDocParser } from '../src/phpDoc';
import { assert } from 'chai';
import 'mocha';

describe('PhpDocParser', function(){

    describe('#parse()', function(){

        it('Should parse function doc block', function(){

            let text = `/**
             * Function summary.
             * Function description.
             * 
             * @param \\My\\Param $myParam Param description
             * @return \\My\\ReturnType
             */`

             let phpDoc = PhpDocParser.parse(text);
             console.log(JSON.stringify(phpDoc, null, 4));

        })


    });


});