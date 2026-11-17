(() => {
	const form = document.getElementById("quote-form");
	const status = form.querySelector(".form-status");
	const button = form.querySelector('button[type="submit"]');

	const inputs = {
		nume: form.querySelector(".nume"),
		firma: form.querySelector(".firma"),
		telefon: form.querySelector(".telefon"),
		email: form.querySelector(".email"),
		mesaj: form.querySelector(".mesaj"),
	};

	const firmaField = inputs.firma.closest(".field");

	const placeholders = {
		pj: "De exemplu: firmă de distribuție, depozit în Timișoara, 8 mașini de livrare, polițele expiră în martie.",
		pf: "De exemplu: RCA și CASCO pentru un autoturism din 2020, apartament în Timișoara.",
	};

	const validator = new JustValidate(form, {
		errorFieldCssClass: "is-invalid",
		errorFieldStyle: {},
		errorLabelCssClass: "field-error",
		errorLabelStyle: {},
		focusInvalidField: true,
		validateBeforeSubmitting: false,
	});

	function clientType() {
		return form.querySelector(".client:checked").value;
	}

	function isCompany() {
		return clientType() === "pj";
	}

	function toggleFirma(visible) {
		firmaField.classList.toggle("is-hidden", !visible);
		firmaField.setAttribute("aria-hidden", String(!visible));
		inputs.firma.disabled = !visible;
	}

	function isValidPhone(value) {
		const phone = String(value).trim();
		const digits = phone.replace(/\D/g, "").length;

		return /^[+()\d\s./-]+$/.test(phone) && digits >= 9 && digits <= 15 && phone.length <= 40;
	}

	function showStatus(text) {
		status.hidden = false;
		status.textContent = text;
	}

	function showServerErrors(fields) {
		const errors = {};

		for (const [name, error] of Object.entries(fields)) {
			if (inputs[name]) {
				errors[`.${name}`] = error;
			}
		}

		validator.showErrors(errors);
	}

	function collectData() {
		return {
			client: clientType(),
			nume: inputs.nume.value.trim(),
			firma: isCompany() ? inputs.firma.value.trim() : "",
			telefon: inputs.telefon.value.trim(),
			email: inputs.email.value.trim(),
			mesaj: inputs.mesaj.value.trim(),
		};
	}

	async function send() {
		button.disabled = true;
		showStatus("Se trimite cererea...");

		try {
			const response = await fetch("api/contact", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(collectData()),
			});
			const body = await response.json().catch(() => ({}));

			if (response.ok) {
				form.reset();
				validator.refresh();
				toggleFirma(true);
				inputs.mesaj.placeholder = placeholders.pj;
				showStatus("Mulțumim! Am primit cererea și te contactăm în cel mai scurt timp.");
				return;
			}

			if (body.fields) {
				showServerErrors(body.fields);
			}

			showStatus(body.error || "Cererea nu a putut fi trimisă. Încearcă din nou.");
		} catch {
			showStatus("Nu ne-am putut conecta. Verifică internetul și încearcă din nou.");
		} finally {
			button.disabled = false;
		}
	}

	form.addEventListener("change", (event) => {
		if (!event.target.classList.contains("client")) {
			return;
		}

		toggleFirma(isCompany());
		inputs.mesaj.placeholder = placeholders[clientType()];

		if (validator.isSubmitted) {
			validator.revalidateField(".firma");
		}
	});

	validator
		.addField(".nume", [
			{ rule: "required", errorMessage: "Completează numele, ca să știm cu cine vorbim" },
			{ rule: "maxLength", value: 120, errorMessage: "Numele poate avea cel mult 120 de caractere" },
		])
		.addField(".firma", [
			{
				validator: (value) => !isCompany() || String(value).trim() !== "",
				errorMessage: "Completează numele firmei",
			},
			{ rule: "maxLength", value: 160, errorMessage: "Numele firmei poate avea cel mult 160 de caractere" },
		])
		.addField(".telefon", [
			{ rule: "required", errorMessage: "Completează telefonul, ca să te putem suna" },
			{ validator: isValidPhone, errorMessage: "Numărul de telefon nu pare corect, de exemplu 0723 123 456" },
		])
		.addField(".email", [
			{ rule: "email", errorMessage: "Adresa de e-mail nu pare corectă, de exemplu nume@firma.ro" },
			{ rule: "maxLength", value: 160, errorMessage: "Adresa de e-mail poate avea cel mult 160 de caractere" },
		])
		.addField(".mesaj", [
			{ rule: "required", errorMessage: "Spune-ne pe scurt ce vrei să asigurăm" },
			{ rule: "maxLength", value: 5000, errorMessage: "Mesajul poate avea cel mult 5000 de caractere" },
		])
		.onFail(() => {
			showStatus("Verifică câmpurile marcate cu roșu");
		})
		.onSuccess(() => {
			send();
		});
})();
