<map version="freeplane 1.8.0">
<!--To view this file, download free mind mapping software Freeplane from http://freeplane.sourceforge.net -->
<attribute_registry SHOW_ATTRIBUTES="hide">
    <attribute_name MANUAL="true" NAME="in.module">
        <attribute_value VALUE=""/>
        <attribute_value VALUE="API"/>
        <attribute_value VALUE="worker"/>
    </attribute_name>
    <attribute_name MANUAL="true" NAME="in.semver">
        <attribute_value VALUE=""/>
        <attribute_value VALUE="0.3.0"/>
        <attribute_value VALUE="0.4.0"/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="in.status">
        <attribute_value VALUE="DONE"/>
        <attribute_value VALUE="IN_PROGRESS"/>
        <attribute_value VALUE="NEW"/>
        <attribute_value VALUE="NEXT"/>
        <attribute_value VALUE="WAITING"/>
        <attribute_value VALUE="WONTFIX"/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="resource.type">
        <attribute_value VALUE=""/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="story.attribute">
        <attribute_value VALUE=""/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="story.form">
        <attribute_value VALUE=""/>
        <attribute_value VALUE="epic"/>
        <attribute_value VALUE="rfc2119"/>
        <attribute_value VALUE="super epic"/>
        <attribute_value VALUE="user story"/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="story.level">
        <attribute_value VALUE="MAY"/>
        <attribute_value VALUE="MUST"/>
        <attribute_value VALUE="SHOULD"/>
    </attribute_name>
    <attribute_name MANUAL="true" RESTRICTED="true" NAME="story.type">
        <attribute_value VALUE="capability"/>
        <attribute_value VALUE="constraint"/>
        <attribute_value VALUE="design decision"/>
        <attribute_value VALUE="functional requirement"/>
        <attribute_value VALUE="non-functional requirement"/>
        <attribute_value VALUE="stakeholder expectation"/>
        <attribute_value VALUE="test"/>
    </attribute_name>
</attribute_registry>
<node TEXT="SIMaaS" FOLDED="false" ID="ID_355979620" CREATED="1570370953126" MODIFIED="1590489083038" STYLE="oval">
<font SIZE="18"/>
<hook NAME="MapStyle">
    <properties fit_to_viewport="false" show_icon_for_attributes="true" show_note_icons="true"/>

<map_styles>
<stylenode LOCALIZED_TEXT="styles.root_node" STYLE="oval" UNIFORM_SHAPE="true" VGAP_QUANTITY="24.0 pt">
<font SIZE="24"/>
<stylenode LOCALIZED_TEXT="styles.predefined" POSITION="right" STYLE="bubble">
<stylenode LOCALIZED_TEXT="default" MAX_WIDTH="600.0 px" COLOR="#000000" STYLE="as_parent">
<font NAME="Liberation Sans" SIZE="10" BOLD="false" ITALIC="false"/>
<edge COLOR="#808080"/>
</stylenode>
<stylenode LOCALIZED_TEXT="defaultstyle.details"/>
<stylenode LOCALIZED_TEXT="defaultstyle.attributes">
<font SIZE="9"/>
</stylenode>
<stylenode LOCALIZED_TEXT="defaultstyle.note"/>
<stylenode LOCALIZED_TEXT="defaultstyle.floating">
<edge STYLE="hide_edge"/>
<cloud COLOR="#f0f0f0" SHAPE="ROUND_RECT"/>
</stylenode>
</stylenode>
<stylenode LOCALIZED_TEXT="styles.user-defined" POSITION="right" STYLE="bubble">
<stylenode LOCALIZED_TEXT="styles.topic" COLOR="#18898b" STYLE="fork">
<font NAME="Liberation Sans" SIZE="10" BOLD="true"/>
</stylenode>
<stylenode LOCALIZED_TEXT="styles.subtopic" COLOR="#cc3300" STYLE="fork">
<font NAME="Liberation Sans" SIZE="10" BOLD="true"/>
</stylenode>
<stylenode LOCALIZED_TEXT="styles.subsubtopic" COLOR="#669900">
<font NAME="Liberation Sans" SIZE="10" BOLD="true"/>
</stylenode>
<stylenode LOCALIZED_TEXT="styles.important" COLOR="#cc003f"/>
<stylenode TEXT="Done" COLOR="#cccccc">
<edge COLOR="#cccccc"/>
</stylenode>
<stylenode TEXT="Question" COLOR="#a99377">
<font ITALIC="true"/>
</stylenode>
</stylenode>
<stylenode LOCALIZED_TEXT="styles.AutomaticLayout" POSITION="right" STYLE="bubble">
<stylenode LOCALIZED_TEXT="AutomaticLayout.level.root" COLOR="#000000">
<font NAME="Liberation Sans" SIZE="16"/>
</stylenode>
<stylenode LOCALIZED_TEXT="AutomaticLayout.level,1" COLOR="#002e40">
<font SIZE="14"/>
</stylenode>
<stylenode LOCALIZED_TEXT="AutomaticLayout.level,2" COLOR="#00648c">
<font SIZE="12"/>
</stylenode>
<stylenode LOCALIZED_TEXT="AutomaticLayout.level,3" COLOR="#0087bd"/>
<stylenode LOCALIZED_TEXT="AutomaticLayout.level,4" COLOR="#111111">
<font SIZE="10"/>
</stylenode>
</stylenode>
</stylenode>
</map_styles>
</hook>
<hook NAME="accessories/plugins/AutomaticLayout.properties" VALUE="ALL"/>
<edge COLOR="#808080"/>
<node TEXT="Stakeholder" FOLDED="true" POSITION="right" ID="ID_1362715508" CREATED="1610209606525" MODIFIED="1610209682669">
<node TEXT="Stakeholders" ID="ID_530363449" CREATED="1610209651046" MODIFIED="1610209660141">
<node TEXT="UdS AES as the chair that has to deliver specified results as part of the Designetz-project" ID="ID_1848430071" CREATED="1610209609812" MODIFIED="1610209609812"/>
<node TEXT="Westnetz/innogy as the company that will run the code in a critical environment" ID="ID_1293770855" CREATED="1610209609812" MODIFIED="1610209609812"/>
<node TEXT="the developers at UdS AES that have to implement and operate the microservice" ID="ID_1180197097" CREATED="1610209609814" MODIFIED="1610209609814"/>
<node TEXT="other microservices that hard-code requests against a specific version of the API" ID="ID_436543351" CREATED="1610209609814" MODIFIED="1610209609814"/>
<node TEXT="human users of service instances that want to use it as a source of data" ID="ID_243872356" CREATED="1610209609814" MODIFIED="1610209609814"/>
<node TEXT="researchers that want to evaluate the service&apos;s concept, its architecture, its capabilities, and its performance" ID="ID_868917135" CREATED="1610209609815" MODIFIED="1610209609815"/>
<node TEXT="researchers/developers that come across the git-repository and want to build upon and extend the current service implementation, possibly in a few years time" ID="ID_1988394170" CREATED="1610209609815" MODIFIED="1610209609815"/>
<node TEXT="me (Moritz Stüber) as the PhD student that expects to demonstrate the viability of his research using this microservice" ID="ID_594885378" CREATED="1610209609816" MODIFIED="1610209609816"/>
</node>
<node TEXT="Expectations" ID="ID_989054330" CREATED="1610209661742" MODIFIED="1610209666742">
<font BOLD="false"/>
<node TEXT="As UdS AES, I expect that..." FOLDED="true" ID="ID_1498987257" CREATED="1610209667022" MODIFIED="1610209667022">
<node TEXT="the microservice holds all the promises originally made and documents that explicitly" ID="ID_232138814" CREATED="1610209667022" MODIFIED="1610209667022"/>
<node TEXT="one can find high-level answers to the questions &quot;what/what not?&quot;, &quot;why?&quot;, &quot;how?&quot;, &quot;documented where?&quot;, &quot;published where?&quot; and &quot;status?&quot; very quickly" ID="ID_1578323222" CREATED="1610209667022" MODIFIED="1610209667022"/>
<node TEXT="one can find up-to-date in-depth documentation that matches the implementation quickly" ID="ID_851721010" CREATED="1610209667022" MODIFIED="1610209667022"/>
</node>
<node TEXT="As Westnetz/innogy, I expect that..." FOLDED="true" ID="ID_1761338205" CREATED="1610209667022" MODIFIED="1610209667022">
<node TEXT="all requirements arising from the assumptions made during risk analysis are indeed met by the developers" ID="ID_1783976070" CREATED="1610209667023" MODIFIED="1610209667023"/>
<node TEXT="the developers behave securely, as indicated in the corresponding written elaboration" ID="ID_1731539333" CREATED="1610209667023" MODIFIED="1610209667023"/>
<node TEXT="I know about all requirements that are not fulfilled (and the reasons for that)" ID="ID_1342730476" CREATED="1610209667023" MODIFIED="1610209667023"/>
<node TEXT="there is documentation about how requirements are implemented" ID="ID_752547749" CREATED="1610209667023" MODIFIED="1610209667023"/>
<node TEXT="there is documentation on how to configure and operate a service instance" ID="ID_130189968" CREATED="1610209667023" MODIFIED="1610209667023"/>
<node TEXT="there is some kind of version history/elaboration on new releases" ID="ID_857788612" CREATED="1610209667023" MODIFIED="1610209667023"/>
</node>
<node TEXT="As a developer at UdS AES, I expect that..." FOLDED="true" ID="ID_152306519" CREATED="1610209667023" MODIFIED="1610209667023">
<node TEXT="the code base and any instances are fully adhere to the defined devops-processes" ID="ID_490723836" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="maintenance and onboarding new developers is straightforward because the code is easy to read" ID="ID_558858017" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="the code base is kept clean by proper usage of branches, atomic commits (whenever possible), proper commit messages, and frequent pushing" ID="ID_1838490422" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="knowledge gained from experimenting is documented appropriately in a timely manner" ID="ID_1310450840" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="all developers contribute to keeping the README and other documentation up to date" ID="ID_294605259" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="the microservices scales across processors and machines dynamically iff necessary" ID="ID_108110810" CREATED="1610209667025" MODIFIED="1610209667025"/>
<node TEXT="measures are taken to prevent regression of the implementation" ID="ID_1681500733" CREATED="1610209667025" MODIFIED="1610209667025"/>
</node>
<node TEXT="As another microservice, I expect that..." FOLDED="true" ID="ID_1386019821" CREATED="1610209667025" MODIFIED="1610209667025">
<node TEXT="there are no (sudden/unannounced) backwards-incompatible API changes" ID="ID_576364662" CREATED="1610209667026" MODIFIED="1610209667026"/>
<node TEXT="requests are resolved almost instantly" ID="ID_1696410566" CREATED="1610209667026" MODIFIED="1610209667026"/>
<node TEXT="the microservice is always online" ID="ID_1874904519" CREATED="1610209667026" MODIFIED="1610209667026"/>
<node TEXT="the microservice doesn&apos;t choke on many requests sent at once" ID="ID_1170697325" CREATED="1610209667026" MODIFIED="1610209667026"/>
</node>
<node TEXT="As a human users of a service instance, I expect that..." FOLDED="true" ID="ID_1098628181" CREATED="1610209667026" MODIFIED="1610209667026">
<node TEXT="the OAS always matches the implementation exactly" ID="ID_439078546" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="the entire interaction with the API happens through the API" ID="ID_1079608994" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="there is a &quot;Getting Started&quot; that takes me to the first `200` in no time" ID="ID_756190554" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="out-of-band documentation (if necessary at all) is easy to find and reference" ID="ID_1247983731" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="out-of-band documentation clearly defines the API version it relates to" ID="ID_43548651" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="there is concise information on version history/new releases" ID="ID_783959298" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="license information can be retrieved automatically" ID="ID_938485129" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="terms of use are clearly defined, if possible in a standardized/machine-readable way" ID="ID_146403662" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="the API behaves &quot;normal&quot;, in the sense that it sticks to standard(ized) behaviour of the web" ID="ID_729810160" CREATED="1610209667028" MODIFIED="1610209667028"/>
<node TEXT="all information is provided in English" ID="ID_380963018" CREATED="1610209667028" MODIFIED="1610209667028"/>
</node>
<node TEXT="As a researcher, I expect that..." FOLDED="true" ID="ID_1966648426" CREATED="1610209667028" MODIFIED="1610209667028">
<node TEXT="there are references to relevant publications, if possible annotated" ID="ID_1755949775" CREATED="1610209667029" MODIFIED="1610209667029"/>
<node TEXT="there is a convenient way to reference (specific versions of) the source code" ID="ID_1972319088" CREATED="1610209667029" MODIFIED="1610209667029"/>
<node TEXT="there is up-to-date information on the current status and the roadmap for development" ID="ID_1242662990" CREATED="1610209667029" MODIFIED="1610209667029"/>
</node>
<node TEXT="As a developer, I expect that..." FOLDED="true" ID="ID_1913098640" CREATED="1610209667029" MODIFIED="1610209667029">
<node TEXT="the README is concise and helpful, but not overwhelming" ID="ID_1075711519" CREATED="1610209667031" MODIFIED="1610209667031"/>
<node TEXT="there are tagged releases that allow understanding what a release is about immediately" ID="ID_877671812" CREATED="1610209667031" MODIFIED="1610209667031"/>
<node TEXT="there is up-to-date information on the current status and the roadmap for development" ID="ID_1713529556" CREATED="1610209667031" MODIFIED="1610209667031"/>
<node TEXT="there is up-to-date contact information/clearly defined ways to reach the developers" ID="ID_1348814360" CREATED="1610209667031" MODIFIED="1610209667031"/>
<node TEXT="there are contribution guidelines that include guidance on getting started with development" ID="ID_1742759342" CREATED="1610209667031" MODIFIED="1610209667031"/>
<node TEXT="maintainers are responsive to requests" ID="ID_1068819446" CREATED="1610209667031" MODIFIED="1610209667031"/>
</node>
<node TEXT="As a PhD student, I expect that..." FOLDED="true" ID="ID_240614586" CREATED="1610209667031" MODIFIED="1610209667031">
<node TEXT="I can reuse most of the code that &quot;powers&quot; Designetz for demonstrating the validity and viability of my research" ID="ID_600893140" CREATED="1610209667032" MODIFIED="1610209667032"/>
<node TEXT="contributions by others do not bloat the service and make it a multi-purpose nightmare -- this is a microservice" ID="ID_1587372192" CREATED="1610209667032" MODIFIED="1610209667032"/>
</node>
</node>
</node>
<node TEXT="Functionality" POSITION="right" ID="ID_1855713457" CREATED="1590489582135" MODIFIED="1612694007418">
<node ID="ID_1106637755" CREATED="1610212616574" MODIFIED="1610212867919"><richcontent TYPE="NODE">

<html>
  <head>
    
  </head>
  <body>
    <p>
      As a user, I want my models to be available <i>aaS</i>
    </p>
  </body>
</html>
</richcontent>
<node TEXT="As a user, I expect an unambiguous specification of the requirements on the FMUs I want to add" ID="ID_1114041178" CREATED="1610213150129" MODIFIED="1610213188280"/>
<node TEXT="As a user, I expect that the API rejects FMUs that do not match the specification" ID="ID_1545406242" CREATED="1610213188818" MODIFIED="1610213219408"/>
</node>
<node TEXT="As a user, I want to add new instances of the supported models/model types" ID="ID_504229954" CREATED="1590496674154" MODIFIED="1590496778199">
<attribute NAME="in.status" VALUE="NEW"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.module" VALUE="API"/>
<node TEXT="The API MUST allow adding new model instances" ID="ID_693569812" CREATED="1610209705441" MODIFIED="1610209705441"/>
</node>
<node TEXT="As a user, I want to retrieve a list of available model instances" ID="ID_1631363192" CREATED="1590496674154" MODIFIED="1590496778179">
<attribute NAME="in.status" VALUE="NEW"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.module" VALUE="API"/>
<node TEXT="The API SHOULD provide a list of model instances that can be filtered" ID="ID_1643907753" CREATED="1610209705443" MODIFIED="1610209705443"/>
<node TEXT="The API SHOULD provide a list of model instances that can be sorted hierarchically" ID="ID_1810845776" CREATED="1610209705443" MODIFIED="1610209705443"/>
</node>
<node TEXT="As a user, I want to retrieve a representation of a specific model instance" ID="ID_1910593405" CREATED="1590496674155" MODIFIED="1590496778191">
<attribute NAME="in.status" VALUE="NEW"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.module" VALUE="API"/>
<node TEXT="The API MUST provide a representation of a model instance" ID="ID_1091966948" CREATED="1610209705442" MODIFIED="1610209705442"/>
</node>
<node TEXT="As a user, I want to delete previously added model instances" ID="ID_1914344331" CREATED="1610211602285" MODIFIED="1610211614791">
<node TEXT="The API SHOULD allow deleting model instances" ID="ID_675156472" CREATED="1610209705446" MODIFIED="1610209705446"/>
</node>
<node TEXT="As a user, I want to trigger simulations of the available model instances" ID="ID_947557376" CREATED="1590489620174" MODIFIED="1590490900492">
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.status" VALUE="DONE"/>
<attribute NAME="in.semver" VALUE="0.3.0"/>
<attribute NAME="in.module" VALUE="API"/>
<node TEXT="The API MUST allow triggering a simulation" ID="ID_1104351950" CREATED="1610209705438" MODIFIED="1610209705438"/>
<node TEXT="The API MUST mitigate timeouts in a consistent manner" ID="ID_604850992" CREATED="1610209705440" MODIFIED="1610209705440"/>
<node TEXT="The worker-process MUST simulate a given FMU 2.0 for co-simulation" ID="ID_1134204070" CREATED="1610209705453" MODIFIED="1610209705453">
<node TEXT="The worker-process MUST allow the specification of start time, stop time, and output interval" FOLDED="true" ID="ID_1135389175" CREATED="1610209705455" MODIFIED="1610209705455">
<node TEXT="The worker-process MUST handle both absolute and relative time as input! (-&gt; epochOffset...)" ID="ID_424489098" CREATED="1610209705455" MODIFIED="1610209705455"/>
</node>
<node TEXT="The worker-process MUST allow providing input to the simulation of an FMU" ID="ID_1007117697" CREATED="1610209705456" MODIFIED="1610209705456"/>
</node>
<node TEXT="As the API, I expect the workers to..." ID="ID_1197326639" CREATED="1612547822679" MODIFIED="1612547822679">
<node TEXT="adhere to the format for exchanging data via message broker/result backend that has been agreed upon" ID="ID_1447114223" CREATED="1612547822679" MODIFIED="1612547822679"/>
<node TEXT="consume valid input that has _not_ been preprocessed" ID="ID_1642393331" CREATED="1612547822679" MODIFIED="1612547822679"/>
<node TEXT="execute a given FMU 2.0 for CS and return the simulation result" ID="ID_499211501" CREATED="1612547822679" MODIFIED="1612547822679"/>
<node TEXT="provide auxiliary information based on the metadata of the FMU" ID="ID_1152076163" CREATED="1612547822679" MODIFIED="1612547822679"/>
</node>
</node>
<node TEXT="As a user, I want to retrieve the results of a simulation" ID="ID_1005945036" CREATED="1590489620175" MODIFIED="1590490900497">
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.status" VALUE="DONE"/>
<attribute NAME="in.semver" VALUE="0.3.0"/>
<attribute NAME="in.module" VALUE="API"/>
<node TEXT="The API MUST provide access to the results of a simulation" ID="ID_1686334838" CREATED="1610209705439" MODIFIED="1610209705439"/>
</node>
<node TEXT="As a user, I want to see the simulations already executed" ID="ID_342089934" CREATED="1610211559713" MODIFIED="1610211588856">
<node TEXT="The API MAY provide a list of executed experiments that can be filtered" ID="ID_38871447" CREATED="1610209705444" MODIFIED="1610209705444"/>
<node TEXT="The API MAY provide a list of executed experiments that can be sorted hierarchically" ID="ID_825084197" CREATED="1610209705445" MODIFIED="1610209705445"/>
</node>
</node>
<node TEXT="DevOps" POSITION="left" ID="ID_854325594" CREATED="1590490981363" MODIFIED="1590495774255">
<node TEXT="Continuous Delivery MUST be implemented" ID="ID_393323080" CREATED="1612695608297" MODIFIED="1612695633506"/>
<node TEXT="The implementation SHOULD comply with internal (team-) requirements" ID="ID_1299300325" CREATED="1610209705435" MODIFIED="1610278291157" LINK="../../../server_config/documentation/devops_guidelines.mm"/>
<node TEXT="The implementation SHOULD comply with external stakeholder requirements" ID="ID_944748908" CREATED="1610209705435" MODIFIED="1610278297036" LINK="../../../../engineering/it-architektur/serviceentwicklung/serviceentwicklung_anforderungen.mm"/>
<node TEXT="The implementation SHOULD NOT suck" ID="ID_1711183612" CREATED="1610211946950" MODIFIED="1610211961477">
<node TEXT="The microservice MUST implement a specified strategy for forgetting old simulation results" ID="ID_1914562797" CREATED="1610209705447" MODIFIED="1610209705447"/>
<node TEXT="The microservice SHOULD implement a specified strategy against (D)DOS (aka &quot;choking to death&quot;)" ID="ID_636303226" CREATED="1610209705447" MODIFIED="1610209705447"/>
<node TEXT="The microservice SHOULD scale across threads, processors and machines dynamically iff necessary" ID="ID_731911660" CREATED="1610209705450" MODIFIED="1610209705450"/>
</node>
</node>
<node TEXT="Test Strategy" POSITION="left" ID="ID_308822550" CREATED="1612693764673" MODIFIED="1612693768352">
<node TEXT="Unit tests for..." ID="ID_1073086984" CREATED="1612547826752" MODIFIED="1612547826752">
<node TEXT="actual functionality, i.e. simulating a FMU 2.0 CS with input etc." ID="ID_321157873" CREATED="1612547826752" MODIFIED="1612547826752">
<node TEXT="minimal working example" ID="ID_1591593696" CREATED="1612547826752" MODIFIED="1612547826752"/>
<node TEXT="*typical example with real data*" ID="ID_781251750" CREATED="1612547826752" MODIFIED="1612547826752"/>
<node TEXT="ensuring that parameters like `epochOffset` are correctly set `WONTFIX`" ID="ID_843845689" CREATED="1612547826752" MODIFIED="1612547826752"/>
</node>
<node TEXT="transforming enqueued message to function call parameters" ID="ID_1634351982" CREATED="1612547826753" MODIFIED="1612547826753"/>
</node>
</node>
<node TEXT="Software Architecture" POSITION="right" ID="ID_1489599051" CREATED="1590496234256" MODIFIED="1590496239736">
<node TEXT="As a devops-engineer, I want to properly separate API, message broker, worker and result storage" ID="ID_303733547" CREATED="1590496149001" MODIFIED="1590496453542">
<attribute NAME="in.semver" VALUE="0.4.0"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="story.type" VALUE="stakeholder expectation"/>
<attribute NAME="in.status" VALUE="IN_PROGRESS"/>
<node TEXT="As a developer, I want to use an established implementation of a distributed task queue instead of a shaky prototype" ID="ID_1551977775" CREATED="1590496149006" MODIFIED="1590496453585">
<attribute NAME="in.semver" VALUE="0.4.0"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.status" VALUE="IN_PROGRESS"/>
</node>
<node TEXT="As a developer, I want to make use of the excellent packages for scientific computing available in Python" ID="ID_529817610" CREATED="1590496149006" MODIFIED="1590496804731">
<attribute NAME="in.semver" VALUE="0.4.0"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.status" VALUE="IN_PROGRESS"/>
<attribute NAME="in.module" VALUE="worker"/>
</node>
<node TEXT="As a developer, I no longer want to parse CLI output but use the native data structures directly" ID="ID_1599345634" CREATED="1590496149006" MODIFIED="1590496804748">
<attribute NAME="in.semver" VALUE="0.4.0"/>
<attribute NAME="story.form" VALUE="user story"/>
<attribute NAME="in.status" VALUE="IN_PROGRESS"/>
<attribute NAME="in.module" VALUE="worker"/>
</node>
</node>
<node TEXT="As a devops-engineer, I want to make sure that I build software&#xa;that can be maintained and extended without too much pain" ID="ID_518153819" CREATED="1610212980102" MODIFIED="1610213047366"/>
</node>
</node>
</map>
