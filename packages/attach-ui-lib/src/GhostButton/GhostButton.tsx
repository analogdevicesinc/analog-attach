import { VscodeButton } from "hds-react";
import { ComponentProps } from "react";
import styles from "./GhostButton.module.scss";
import classnames from "classnames";

type GhostButtonProps = ComponentProps<typeof VscodeButton>;

export default function GhostButton(props: GhostButtonProps) {
	const enhancedProps = {...props, className: classnames(styles.customTetriary, props.className)};

	return <VscodeButton {...enhancedProps} variant="tertiary" iconOnly/>
}