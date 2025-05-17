<?php namespace DE\RUB\OntologiesMadeEasyExternalModule;

class InjectionHelper {

    /** @var AbstractExternalModule $module */
    private $module = null;
    private $basePath;

    private function __construct($module) {
        $this->module = $module;
        $this->basePath = $module->getModulePath();
    }

    public static function init($module) {
        if ($module->framework == null) {
            throw new \Exception("Not supported for framework v1 modules!");
        }
        return new InjectionHelper($module);
    }

    /**
     * Includes a JS file (either in-line or as a separately loaded resoure).
     * @param string $file The path of the JS file relative to the module folder without leading slash.
     * @param bool $inline Determines whether the script will be inlined or loaded as a separate resource.
     */
    public function js($file, $inline = false) {
        if ($inline) {
            $script = file_get_contents($this->basePath . $file);
            echo "<script type=\"text/javascript\">\n{$script}\n</script>";
        }
        else {
            echo '<script type="text/javascript" src="' . $this->module->framework->getUrl($file) . '"></script>';
        }
    }

    /**
     * Includes a CSS file (either in-line or as a separately loaed resource).
     * @param string $file The path of the CSS file relative to the module folder.
     * @param bool $inline Determines whether the styles will be inlined or loaded as a separate resource.
     */
    public function css($file, $inline = false) {
        if ($inline) {
            $css = file_get_contents($this->basePath . $file);
            echo "<style>\n{$css}\n</style>\n";
        }
        else {
            $css = $this->module->framework->getUrl($file);
            $file = md5($file);
            echo "<script type=\"text/javascript\">
                    (function() {
                        var id = 'emcCSS{$file}'
                        if (!document.getElementById(id)) {
                            var head = document.getElementsByTagName('head')[0]
                            var link = document.createElement('link')
                            link.id = id
                            link.rel = 'stylesheet'
                            link.type = 'text/css'
                            link.href = '{$css}'
                            link.media = 'all'
                            head.appendChild(link)
                        }
                    })();
                </script>";
        }
    }
}