import { Component } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  MatListItem,
  MatListItemIcon,
  MatListItemTitle,
  MatListSubheaderCssMatStyler,
  MatNavList,
} from '@angular/material/list';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NAV_SECTIONS } from './nav-items';

@Component({
  selector: 'app-sidebar',
  imports: [
    MatIcon,
    MatListItem,
    MatListItemIcon,
    MatListItemTitle,
    MatListSubheaderCssMatStyler,
    MatNavList,
    RouterLink,
    RouterLinkActive,
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  protected readonly sections = NAV_SECTIONS;
}
