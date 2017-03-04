<?php
        
    if($argc !== 2){
        die('Usage: php phpdocs.php <PHP_DOC_DIR>');
    }
    
    if(!($dir = new DirectoryIterator($argv[1]))){
        die('Failed to open ' . $argv[1]);
    }
    
    libxml_use_internal_errors();
    
    $symbols = array();
    $start = microtime(true);
    foreach ($dir as $fileinfo) {
        if ($fileinfo->isDot() || $fileinfo->isDir()) {
            continue;
        }
        
        $dom = new DOMDocument();
        if(!@$dom->loadHTMLFile($fileinfo->getPathname())){
            echo "Failed to load DOM\n";
        }
        
        foreach(array_filter(getFunctionInfo($dom)) as $s){
            $symbols[] = $s;
        }
        foreach(array_filter(getClassPropertiesConstants($dom)) as $s){
            $symbols[] = $s;
        }
        
        
    }   
    
    var_dump(count($symbols));
    var_dump('elapsed : ' . (microtime(true) - $start));
    var_dump($symbols);
    
    function getClassPropertiesConstants($dom){
        
        $symbols = array();
        
        $xpath = new DOMXpath($dom);
        
        $classNodes = $xpath->query('(/html/body/div[2]/div/div[2]/div/div[contains(@class, "classsynopsisinfo")])[1]');
        if(!$classNodes->length){
            return $symbols;
        }
        
        $versionNode = $xpath->query('/html/body//p[contains(@class, "verinfo")]');
        if(!$versionNode->length || stripos($versionNode->item(0)->nodeValue, 'php') === false){
            return array();
        }
        
        $classString = trim(preg_replace('~\s+,\s+|\s+(?:extends|implements)\s+|\s+~', ' ',$classNodes->item(0)->textContent), " \t\n\r\0\x0B{");
        $classExplode = explode(' ', $classString);
        
        $className = array_shift($classExplode);
        $classContext = '';
        if(($separator = strrpos($className, '\\')) !== false){
            $classContext = substr($className, $separator + 1);
            $className = substr($className, 0, $separator);
        }
        
        $descriptionNodes = $xpath->query('/html/body/div[2]/div/div[1]/p');
        $description = '';
        if($descriptionNodes->length){
            $description = trim(preg_replace('~\s+~', ' ', $descriptionNodes->item(0)->nodeValue));
        }
        
        $classSymbol = array(
          'type'=>1,
          'context' =>$classContext,
          'name'=>$className,
          'associated'=>$classExplode,
          'description'=>$description
        );
        
        
        
        //var_dump($classSymbol);
        
        
        //class properties
        $propNodeList = $xpath->query('/html/body//div[contains(@class, "classsynopsis")]/div[contains(@class, "fieldsynopsis")]');
        $propdescriptionNodes = $dom->getElementsByTagName('dl');
        
        if(!$propNodeList->length){
            return $symbols;
        }
        
        $propDescriptions = array();
        $lastDt = null;
        if($propdescriptionNodes->length){
            $dl = $propdescriptionNodes->item(0);
            foreach ($dl->childNodes as $child) {
                if(!($child instanceof DOMElement)){
                    continue;
                }
                
                if($child->tagName === 'dt'){
                    $lastDt = trim($child->textContent);
                } else if($child->tagName === 'dd'){
                    $propDescriptions[$lastDt] = trim(preg_replace('~\s+~', ' ', $child->textContent));
                }
            }
        }
        
        //var_dump($propDescriptions);
        
        for($n = 0; $n < $propNodeList->length; ++$n){
            
            $property = preg_replace('~\s+~', ' ',$propNodeList->item($n)->textContent);
            //var_dump(array($className, $property));
            $matches = array();
            if(!preg_match('~\s*(?:(readonly|static)\s+)?(public|protected|const)\s+(?:([^\s]+)\s+)(\$?[^\s;]+)~', $property, $matches)){
                continue;
            }
            
            
            list($all, $readonly, $modifier, $type, $name) = $matches;
            
            //look for description
            $trimmedName = trim($name, "\$ \t\n\r\0\x0B");
            $description = isset($propDescriptions[$trimmedName]) ? $propDescriptions[$trimmedName] : '';
            
             $symbol = array(
            'type'=>1,
            'context'=>$className,
            'name'=>$name,
            'modifiers'=>1,
            'signature'=>$type,
            'description'=>$description 
            );
            $symbols[] = $symbol;
            //var_dump($symbol);
        }
        
        return $symbols;
    }
    
    function getFunctionInfo($dom){
        $symbols = array();
        $xpath = new DOMXpath($dom);
        $nodes = $xpath->query('/html/body/div[2]/div[2 and contains(@class, "refsect1")]/div[contains(@class, "dc-description")]');
        if(!$nodes->length){
            return $symbols;
        }
        
        $versionNode = $xpath->query('/html/body//p[contains(@class, "verinfo")]');
        if(!$versionNode->length || stripos($versionNode->item(0)->nodeValue, 'php') === false){
            return array();
        }
        
        $descriptionNodes = $xpath->query('(/html/body/div[2]/div[2]/p[contains(@class, "rdfs-comment")])[last()]');
        $description = '';
        if($descriptionNodes->length){
            $description = trim(preg_replace('~\s+~', ' ', $descriptionNodes->item(0)->nodeValue));
        }
        
        for($n = 0; $n < $nodes->length; ++$n){
        
        $signature = preg_replace('~\s+~', ' ',$nodes->item($n)->textContent);
        
        $pattern = '~\s*(?:(final)\s+)?(?:(static)\s+)?(?:(public|private|protected)\s+)?([^\s:]*)\s+(?:([^\s:]+)::([^\s:]+)|([^\s:]+))\s*\(\s*(.*)\s*\)\s*~s';
        
        $matches = array();
        if(!preg_match($pattern, $signature, $matches)){
            continue;
        }
        
        
        
        foreach($matches as $key => $value){
            $matches[$key] = trim($value);
        }
        
        list($all, $final, $static, $public, $returnType, $class, $classMethod, $function, $parameters) = $matches;
        
        if($parameters === 'void'){
            $parameters = '';
        }
        
        if(!$returnType){
            $returnType = $classMethod === '__construct' ? $class : 'void';
        }
        
        $symbol = array(
            'type'=>1,
            'context'=>$class,
            'name'=>$class ? $classMethod : $function,
            'modifiers'=>1,
            'signature'=>"({$parameters}) : $returnType",
            'description'=>$description 
        );
        if($symbol['name']){
            $symbols[] = $symbol;
        } else {
            continue;
        }
        
        //params
        $propdescriptionNodes = $dom->getElementsByTagName('dl');
        
        $propDescriptions = array();
        $lastDt = null;
        if($propdescriptionNodes->length){
            $dl = $propdescriptionNodes->item(0);
            foreach ($dl->childNodes as $child) {
                if(!($child instanceof DOMElement)){
                    continue;
                }
                
                if($child->tagName === 'dt'){
                    $lastDt = trim($child->textContent);
                } else if($child->tagName === 'dd'){
                    $propDescriptions[$lastDt] = trim(preg_replace('~\s+~', ' ', $child->textContent));
                }
            }
        }
        
        //parse params
        $paramSplit = array_filter(preg_split('~\s*(?:\[\s*)?,\s*~', $parameters, -1, PREG_SPLIT_NO_EMPTY));
        
        foreach($paramSplit as $p){
            
            $parts = explode(' ', trim($p, " \t\n\r\0\x0B]"));
            
            $type = array_shift($parts);
            $name = array_shift($parts);
            array_shift($parts);
            $value = array_shift($parts);
            
            
            $paramSymbol = array(
                'type'=>1,
                'context'=>$class ? "$class::{$symbol['name']}" : $symbol['name'],
                'name'=>$name,
                'signature'=>$type,
                'description'=>isset($propDescriptions[trim($name, '$&')]) ? $propDescriptions[trim($name, '$&')] : ''
            );
            if($value !== null){
                $paramSymbol['value'] = $value;
            }
            $symbols[] = $paramSymbol;
        }
        }
        return $symbols;
    }