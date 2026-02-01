<?php namespace DE\RUB\OntologiesMadeEasyExternalModule;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();
$ih->css("libs/tom-select_2.4.3/tom-select.css");    
$ih->js("libs/tom-select_2.4.3/tom-select.complete.min.js");


?>
    
<h1 class="projhdr">
	<i class="fa fa-search"></i> ROME: Discover Metadata from other projects
</h1>
     <p> On this page, you can search other REDCap projects
     <ul>
     <li>on this specific REDCap instance</li>
     <li>which were explicitely marked "discoverable" </li>
     </ul>
     </p>

<select id="rome-discover" autofocus="autofocus" multiple></select>

<div id="resulttable" style="margin-top: 24px" ></div>

<?php $module->initializeJavascriptModuleObject(); ?>

<script>
    $(function() {
        var rome_info;
        var tomselect;
        function updateProjectTable() {
            var fields;
            var projects;
            if (tomselect && tomselect.getValue().length > 0) {
                let values = tomselect.getValue();
                let sets   = values.map(field_index => (new Set(rome_info.fields[field_index].projects)));
                let project_ids = sets.pop();
                while (project_ids.size > 0 && sets.length > 0) {
                    project_ids = project_ids.intersection(sets.pop());
                }
                function fieldnamesForProject(project_id) {
                    return values
                        .filter(i => rome_info.fields[i].field_names[project_id])
                        .map(i => `${rome_info.fields[i].display}: ${rome_info.fields[i].field_names[project_id]}`)
                        .join("<br>")
                }
                var html = `<table class="table">
                              <thead>
                                 <tr><th>PID</th><th>Project Name</th><th>Contact</th><th>Email</th><th>Fields</th></tr>
                              </thead>
                              <tbody>` + 
                   [...project_ids].map(project_id => `<tr>
                                                  <td>${project_id}</td>
                                                  <td>${rome_info.projects[project_id].app_title}</td>
                                                  <td>${rome_info.projects[project_id].contact}</td>
                                                  <td>${rome_info.projects[project_id].email}</td>
                                                  <td>${fieldnamesForProject(project_id)}</td>
                                               </tr>`).join("") +
                    `</tbody></table>`;
                $("#resulttable").html(html);
            } else {
                $("#resulttable").html(`<i>Searching in ${rome_info.projects.keys.length} discoverable, annotated projects</i>`);
            }
        }
        const module = <?=$module->getJavascriptModuleObjectName()?>;
        module.ajax('discover', {}).then(function(response) {
            rome_info = JSON.parse(response);
            var options = rome_info.fields.map((f, i) => ({"id": i,
                            "title": `${f.display} [${f.system}: ${f.code}], n=${f.projects.length}`}));
            var settings = {"options": options,
                    valueField: 'id',
                    onChange: updateProjectTable,
                    labelField: 'title',
                    searchField: 'title'};
            tomselect = new TomSelect('#rome-discover',settings);

        }).catch(function(err) {
            console.log(`error requesting ROME info: ${err}`);
        });

    })

</script>    

