import { NgModule } from '@angular/core';
import { ProgressBarComponent } from './progress-bar/progress-bar';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { IonicModule } from "ionic-angular";

@NgModule({
	declarations: [
		ProgressBarComponent,
	],
	imports: [CommonModule, TranslateModule, IonicModule],
	exports: [
		ProgressBarComponent,
	]
})
export class ComponentsModule { }
