import { Component } from '@angular/core';
import { Config, Platform } from 'ionic-angular';
import { StatusBar } from '@ionic-native/status-bar';
import { SplashScreen } from '@ionic-native/splash-screen';
import { createConnection } from 'typeorm';
import { ThemeService } from '../providers/theme/theme';
@Component({
  templateUrl: 'app.html'
})
export class MyApp {
  rootPage: any = null;

  constructor(
    platform: Platform,
    statusBar: StatusBar,
    splashScreen: SplashScreen,
    private config: Config,
    private themeService: ThemeService,
  ) {

    platform.ready().then(async () => {

      splashScreen.hide();


      this.config.set('ios', 'backButtonText', 'Voltar');

      this.themeService.init();

      this.rootPage = "HomePage";
    });
  }
}

