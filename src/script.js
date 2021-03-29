function hideAds() {
	//o script pega todos os scripts do site (blocked_js.js)
	let scripts = document.getElementsByTagName("script");

	//e analisa para ver se contém algo que vai lançar anuncios
	for (let i = 0; i < scripts.length; i++) {
		//criar lista de elementos de anuncio e colocar algoritmo aqui
		if (scripts[i].innerHTML.includes("adPlacements") == true || scripts[i].innerHTML.includes("playerAds") == true) {
			//excluindo todo o script e escondendo ele
			scripts[i].setAttribute("style", "display: none;");
			scripts[i].innerHTML = " "
		}
	}

	//também pega todos os divs (para analise) e todos os elementos
	// que tem nome de anuncio (blocked_cosmetic.js)
	let divs = document.getElementsByTagName("div");
	//criar lista de elementos com nome de anuncio e colocar algoritmo aqui
	let adunit = document.getElementsByTagName("adunit","ytd-display-ad-renderer","ytd-carousel-ad-renderer","ytd-promoted-sparkles-web-renderer");

	//os que tem nome de anuncio sao bloqueados
	for (let i = 0; i < adunit.length; i++) {
		adunit[i].setAttribute("style", "display: none;");
	}

	//os anuncios sao analisados
	for (let i = 0; i < divs.length; i++) {
		let id = divs[i].getAttribute('id');
		let classes = divs[i].getAttribute('class');
		//se o id ou a classe do div estao nas listas de bloqueio, eles sao bloqueados
		if (blocked_ids.includes(id) == true || blocked_classes.includes(classes) == true) {
			divs[i].setAttribute("style", "display: none;");
		}
	}
}

//colocar receive message aqui

//lista de teste de ids
	

var j = 0;
setInterval(function () {
	hideAds();
	j++;
	if (j == 5) {
		clearInterval();
	}
},500)
