<?php namespace DE\RUB\OntologiesMadeEasyExternalModule;

use \REDCap as REDCap;

/**
 * Class ActionTagHelper
 *
 * A class for helping to parse custom action tags
 */
class ActionTagHelper
{
    // Cache the search results to speed complex queries or queries with many hooks
    static $cache = array();

    /**
     * This is a utility function to return action tags, fields, and parameters for specific action-tag scripts
     *
     * @param null $tags        a single or array of action_tags that you are looking for
     * @param null $fields      a single or array of fields that you want to look in
     * @param null $instruments a single or array of instruments to look in
     * @param null $context     an array with context ("project_id", "record", "instrument", "event_id", "instance") 
     *                          needed to evaluate @IF action tags
     * @throws \Exception
     * @return array            [ "tag1": [
     *                              "field_name": [
     *                                  "params": any parameters next to tag (supports string, list, or json)
     */
    static function getActionTags($tags = NULL, $fields = NULL, $instruments = NULL, $context = NULL) {

        // Check to see if this search has been cached
        $arg_key = md5(json_encode(func_get_args()));
        if (isset(self::$cache[$arg_key])) {
            // \Plugin::log($arg_key, "DEBUG", "Using Cache");
            return self::$cache[$arg_key];
        }

        // Convert tag_filter into uppercase array
        if (!empty($tags)) {
            if (!is_array($tags)) $tags = array($tags);
            $tags = array_map('strtoupper', $tags);
        }
        // Plugin::log($tag_filter,"DEBUG","tag filter ");

        // Get the metadata with applied filters
        $q = REDCap::getDataDictionary('json', false, $fields, $instruments);
        $metadata = json_decode($q,true);
        // Plugin::log($metadata,"DEBUG","Metadata");

        // Build action_tag array
        $action_tags = array();
        foreach ($metadata as $field) {
            $field_name = $field['field_name'];
            $field_annotation = $field['field_annotation'];
            if (is_array($context) && strpos($field_annotation, "@IF") !== false) {
                $field_annotation = \Form::replaceIfActionTag($field_annotation, $context['project_id'] ?? null, $context['record'] ?? null, $context['event_id'] ?? null, $context['instrument'] ?? null, $context['instance'] ?? 1);
            }
            $parsed_tags = self::parseActionTags($field_annotation);
            // Plugin::log($tags, "DEBUG", "TAGS for $field_name");
            foreach ($parsed_tags as $tag) {
                // All action-tags should be parsed as uppercase
                $action_tag = strtoupper($tag['actiontag']);

                // If we are filtering, skip non-specified tags
                if ($tags AND !in_array($action_tag, $tags)) continue;

                // Initialize the action_tag node
                if (!isset($action_tags[$action_tag])) $action_tags[$action_tag] = array();

                // Merge action_tag into action_tags
                $action_tags[$action_tag] = array_merge( $action_tags[$action_tag],
                    array($field_name => array(
                        'params' => isset($tag['params']) ? $tag['params'] : ""
                    )
                    )
                );
            }
        }

        // Cache this search
        self::$cache[$arg_key] = $action_tags;

        return $action_tags;
    }


    /**
     * Parses a string for arrays of actiontags (optionally filtering by the supplied tag)
     * Examples of valid action tags are:
     * @TAG1
     * @TAG2=1,2,3
     * @TAG3={
     *   "key":"value",
     *   "key2","value2"
     * }
     *
     * The results are an array where each match is an actiontag with a key of
     * [0] => [
     *   "actiontag" => "@TAG1"
     * ],
     * [1] => [
     *   "actiontag" => "@TAG2",
     *   "params"    => "1,2,3"
     * ],
     * [2] => [
     *   "actiontag" => "@TAG3",
     *   "params"    => "{"key":"value","key2","value2"}
     *
     * https://regex101.com/r/fL2rM8/5
     * 
     * An updated version of the regex is here - but is not used. It doesn't work as intended in all cases.
     * https://regex101.com/r/dWEkmN/2
     *
     * @param $string           The string to be parsed for actiontags (in the format of <code>@FOO=BAR or @FOO={"param":"bar"}</code>
     * @param null $tag_only    If you wish to select a single tag
     * @return array|bool       returns the match array with the key equal to the tag and an array containing keys of 'params, params_json and params_text'
     */
    static function parseActionTags($string, $tag_only = null) {
        $re = "/(?(DEFINE)
          (?<number>    -?  (?= [1-9]|0(?!\d) ) \d+ (\.\d+)? ([eE] [+-]? \d+)? )
          (?<boolean>   true | false | null )
          (?<string>    \" ([^\"\\\\]* | \\\\ [\"\\\\bfnrt\/] | \\\\ u [0-9a-f]{4} )* \" )
          (?<array>     \[  (?:  (?&json)  (?: , (?&json)  )*  )?  \s* \] )
          (?<pair>      \s* (?&string) \s* : (?&json)  )
          (?<object>    \{  (?:  (?&pair)  (?: , (?&pair)  )*  )?  \s* \} )
          (?<fieldname> [a-zA-Z0-9\_\-]+ )
          (?<json>      \s* (?: (?&number) | (?&boolean) | (?&string) | (?&array) | (?&object) )  )
          (?<fieldlist> (?: (?&fieldname) (?: , (?&fieldname) )+ )+ )  
        )
        (?'actiontag'
          \@(?&fieldname)
        )
        (?:\=
          (?'params'
            (?:
              (?'match_list'(?&fieldlist))
              |
              (?'match_json'(?&json))
              |
              (?'match_string'(?:[[:alnum:]\_\-]+))
            )
          )
        )?/ixm";

        preg_match_all($re, $string, $matches);

        // Return false if none are found
        if (count($matches['actiontag']) == 0) return false;

        $results = array();

        foreach ($matches['actiontag'] as $i => $tag) {
            $tag = strtoupper($tag);
            if ($tag_only && ($tag != strtoupper($tag_only))) continue;
            $results[] = array(
                'actiontag' => $tag,
                'params' => $matches['params'][$i],
                'match' => $matches[0],
            );
        }
        return $results;
    }
}
